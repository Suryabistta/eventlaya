"""Printed tickets for physical sales (module `offline_tickets`).

GET  /api/events/<id>/ticket-batches/                     batches with sold-at-gate stats
POST /api/events/<id>/ticket-batches/                     create a batch: bulk-generates real tickets
POST /api/events/<id>/ticket-batches/preview/             PNG of a sample ticket for the design (nothing saved)
GET  /api/events/<id>/ticket-batches/<b>/pdf/?part=1&per_page=sheet|single
GET  /api/events/<id>/ticket-batches/<b>/csv/
POST /api/events/<id>/ticket-batches/<b>/void/            cancels the batch's tickets nobody has used yet
"""
import csv
import re
import secrets
from math import ceil

from django.db import transaction
from django.db.models import Count, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Event, EventTicket, TicketBatch, TicketType
from .printed import MAX_PER_PDF, Design, build_pdf, preview_png
from .views import can_manage_event

MAX_QUANTITY = 2000
HEX = re.compile(r'^#[0-9a-fA-F]{6}$')


class DesignSerializer(serializers.Serializer):
    layout = serializers.ChoiceField(choices=Event.PassLayout.choices, default=Event.PassLayout.LANDSCAPE)
    template = serializers.ChoiceField(choices=TicketBatch.Template.choices, default=TicketBatch.Template.CLASSIC)
    color = serializers.CharField(default='#C2215A')
    background = serializers.CharField(required=False, allow_blank=True, default='')
    qr_x = serializers.IntegerField(min_value=0, max_value=100, default=80)
    qr_y = serializers.IntegerField(min_value=0, max_value=100, default=50)
    qr_size = serializers.IntegerField(min_value=10, max_value=60, default=28)
    ticket_type = serializers.UUIDField(required=False, allow_null=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0, required=False, allow_null=True)

    def validate_color(self, value):
        if not HEX.match(value):
            raise serializers.ValidationError('Use a colour like #C2215A.')
        return value

    def validate(self, attrs):
        if attrs['template'] == TicketBatch.Template.CUSTOM and not attrs.get('background'):
            raise serializers.ValidationError({'background': 'Upload your artwork, or pick a ready-made design.'})
        event = self.context['event']
        tt_id = attrs.get('ticket_type')
        if tt_id:
            tt = TicketType.objects.filter(pk=tt_id, event=event).first()
            if tt is None:
                raise serializers.ValidationError({'ticket_type': 'Pick a ticket type of this event.'})
            attrs['ticket_type'] = tt
            if attrs.get('price') is None:
                attrs['price'] = tt.price
        else:
            attrs['ticket_type'] = None
        if attrs.get('price') is None:
            attrs['price'] = 0
        return attrs


class BatchSerializer(DesignSerializer):
    name = serializers.CharField(max_length=120)
    quantity = serializers.IntegerField(min_value=1, max_value=MAX_QUANTITY)
    ticket_type = serializers.UUIDField()

    def validate(self, attrs):
        attrs = super().validate(attrs)
        event = self.context['event']
        if event.capacity:
            free = event.capacity - event.tickets.exclude(status='cancelled').count()
            if attrs['quantity'] > free:
                raise serializers.ValidationError({'quantity': f'Only {max(free, 0)} places are left within the event capacity.'})
        return attrs


def design_for(event, data):
    tt = data.get('ticket_type')
    return Design(
        event=event, layout=data['layout'], template=data['template'], color=data['color'],
        background=data.get('background', ''), qr_x=data['qr_x'], qr_y=data['qr_y'], qr_size=data['qr_size'],
        type_name=tt.name if tt else '', price=data.get('price') or 0,
    )


def batch_data(b):
    return {
        'id': str(b.id), 'name': b.name, 'quantity': b.quantity, 'price': str(b.price),
        'ticket_type': str(b.ticket_type_id) if b.ticket_type_id else None,
        'ticket_type_name': b.ticket_type.name if b.ticket_type_id else '',
        'layout': b.layout, 'template': b.template, 'color': b.color, 'background': b.background,
        'qr_x': b.qr_x, 'qr_y': b.qr_y, 'qr_size': b.qr_size,
        'used': getattr(b, 'used', 0), 'voided_at': b.voided_at, 'created_at': b.created_at,
        'parts': ceil(b.quantity / MAX_PER_PDF),
    }


class _EventMixin:
    permission_classes = [permissions.IsAuthenticated]

    def event_or_error(self, request, pk):
        event = get_object_or_404(Event.objects.select_related('organizer'), pk=pk)
        if not can_manage_event(request.user, event):
            return None, Response({'error': 'Only the organizer can manage printed tickets.'}, status=status.HTTP_403_FORBIDDEN)
        return event, None


def _tickets_of(batch):
    return list(batch.tickets.order_by('ticket_number').values_list('ticket_number', 'qr_token'))


class TicketBatchListView(_EventMixin, APIView):
    def get(self, request, pk):
        event, err = self.event_or_error(request, pk)
        if err:
            return err
        batches = event.ticket_batches.select_related('ticket_type').annotate(
            used=Count('tickets', filter=Q(tickets__first_check_in__isnull=False)),
        )
        return Response([batch_data(b) for b in batches])

    def post(self, request, pk):
        event, err = self.event_or_error(request, pk)
        if err:
            return err
        s = BatchSerializer(data=request.data, context={'event': event})
        s.is_valid(raise_exception=True)
        d = s.validated_data
        tt = d['ticket_type']
        with transaction.atomic():
            batch = TicketBatch.objects.create(
                event=event, ticket_type=tt, name=d['name'].strip(), quantity=d['quantity'], price=d['price'],
                created_by=request.user, layout=d['layout'], template=d['template'], color=d['color'],
                background=d.get('background', ''), qr_x=d['qr_x'], qr_y=d['qr_y'], qr_size=d['qr_size'],
            )
            # PRT-<event>-<batch>-0001: readable at the counter, unique per batch
            prefix = f'PRT-{str(event.id)[:4].upper()}-{str(batch.id)[:4].upper()}'
            label = f'Printed · {batch.name}'[:255]
            EventTicket.objects.bulk_create([
                EventTicket(
                    event=event, batch=batch, ticket_number=f'{prefix}-{i:04d}', qr_token=secrets.token_hex(20),
                    attendee_name=label, attendee_email='', ticket_type=tt, ticket_type_name=tt.name if tt else '',
                    price=0,  # paid at the shop or counter, nothing to collect at the gate
                )
                for i in range(1, d['quantity'] + 1)
            ], batch_size=500)
        batch.used = 0
        return Response(batch_data(batch), status=status.HTTP_201_CREATED)


class TicketBatchPreviewView(_EventMixin, APIView):
    def post(self, request, pk):
        event, err = self.event_or_error(request, pk)
        if err:
            return err
        s = DesignSerializer(data=request.data, context={'event': event})
        s.is_valid(raise_exception=True)
        return HttpResponse(preview_png(design_for(event, s.validated_data)), content_type='image/png')


class _BatchView(_EventMixin, APIView):
    def batch_or_error(self, request, pk, batch_id):
        event, err = self.event_or_error(request, pk)
        if err:
            return None, err
        return get_object_or_404(TicketBatch.objects.select_related('event', 'ticket_type'), pk=batch_id, event=event), None


class TicketBatchPdfView(_BatchView):
    def get(self, request, pk, batch_id):
        batch, err = self.batch_or_error(request, pk, batch_id)
        if err:
            return err
        if batch.voided_at:
            return Response({'error': 'This batch was voided; its tickets no longer get in.'}, status=status.HTTP_400_BAD_REQUEST)
        tickets = _tickets_of(batch)
        try:
            part = max(1, int(request.query_params.get('part', 1)))
        except ValueError:
            part = 1
        chunk = tickets[(part - 1) * MAX_PER_PDF: part * MAX_PER_PDF]
        if not chunk:
            return Response({'error': 'No such part.'}, status=status.HTTP_404_NOT_FOUND)
        per_page = 'single' if request.query_params.get('per_page') == 'single' else 'sheet'
        pdf = build_pdf(Design.for_batch(batch), chunk, per_page)
        name = slugify(f'{batch.event.title}-{batch.name}') or 'printed-tickets'
        suffix = f'-part{part}' if len(tickets) > MAX_PER_PDF else ''
        resp = HttpResponse(pdf, content_type='application/pdf')
        resp['Content-Disposition'] = f'attachment; filename="{name}{suffix}.pdf"'
        return resp


class TicketBatchCsvView(_BatchView):
    def get(self, request, pk, batch_id):
        batch, err = self.batch_or_error(request, pk, batch_id)
        if err:
            return err
        resp = HttpResponse(content_type='text/csv')
        resp['Content-Disposition'] = f'attachment; filename="{slugify(batch.name) or "batch"}-tickets.csv"'
        w = csv.writer(resp)
        w.writerow(['Ticket', 'Type', 'Price', 'Status', 'Checked in'])
        for t in batch.tickets.order_by('ticket_number'):
            w.writerow([t.ticket_number, t.ticket_type_name, batch.price, t.status, t.first_check_in or ''])
        return resp


class TicketBatchVoidView(_BatchView):
    """Unsold or lost tickets stop working at the gate. {from, to} voids a run of numbers (e.g. 401–500 returned
    unsold by a shop); without them the whole batch. Tickets already scanned in are never touched."""

    def post(self, request, pk, batch_id):
        batch, err = self.batch_or_error(request, pk, batch_id)
        if err:
            return err
        qs = batch.tickets.filter(first_check_in__isnull=True).exclude(status='cancelled')
        whole = request.data.get('from') in (None, '') and request.data.get('to') in (None, '')
        if not whole:
            try:
                lo, hi = int(request.data.get('from')), int(request.data.get('to'))
            except (TypeError, ValueError):
                return Response({'error': 'Enter the first and last ticket number to void.'}, status=status.HTTP_400_BAD_REQUEST)
            if not 1 <= lo <= hi <= batch.quantity:
                return Response({'error': f'Use numbers between 1 and {batch.quantity}.'}, status=status.HTTP_400_BAD_REQUEST)
            prefix = batch.tickets.values_list('ticket_number', flat=True).first().rsplit('-', 1)[0]
            qs = qs.filter(ticket_number__in=[f'{prefix}-{i:04d}' for i in range(lo, hi + 1)])
        with transaction.atomic():
            voided = qs.update(status='cancelled')
            if whole:
                batch.voided_at = timezone.now()
                batch.save(update_fields=['voided_at', 'updated_at'])
        return Response({'voided': voided})
