"""Ticket types (General, Early Bird, Student, VIP...) and promo codes for events.

A ticket records its price; how it's paid (venue / online) lives on its TicketOrder (see online_payments.py).
"""
from datetime import datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Event, EventGate, EventTicket, PromoCode, TicketType


def _can_manage(user, event):
    return bool(getattr(user, 'is_superadmin', False)) or event.organizer_id == user.id


def _money(value):
    return Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def sync_event_price(event):
    """Keep the legacy is_paid / ticket_price fields in step for older screens (lowest paid price)."""
    prices = [t.price for t in event.ticket_types.filter(is_active=True, is_hidden=False) if t.price > 0]
    is_paid, price = (True, min(prices)) if prices else (False, Decimal('0'))
    if event.is_paid != is_paid or event.ticket_price != price:
        Event.objects.filter(pk=event.pk).update(is_paid=is_paid, ticket_price=price)
        event.is_paid, event.ticket_price = is_paid, price


# ---------- Serializers ----------

class TicketTypeSerializer(serializers.ModelSerializer):
    sold = serializers.SerializerMethodField()
    remaining = serializers.SerializerMethodField()
    availability = serializers.SerializerMethodField()
    allowed_gates = serializers.PrimaryKeyRelatedField(many=True, queryset=EventGate.objects.all(), required=False)
    allowed_gate_names = serializers.SerializerMethodField()

    class Meta:
        model = TicketType
        fields = [
            'id', 'name', 'description', 'price', 'quantity', 'sales_start', 'sales_end', 'gate_note',
            'is_hidden', 'is_active', 'allowed_gates', 'allowed_gate_names', 'order',
            'sold', 'remaining', 'availability', 'online_only',
        ]
        read_only_fields = ['id']

    def _sold(self, obj):
        sold = getattr(obj, 'sold', None)
        return obj.sold_count if sold is None else sold

    def get_sold(self, obj):
        return self._sold(obj)

    def get_remaining(self, obj):
        return None if obj.quantity is None else max(0, obj.quantity - self._sold(obj))

    def get_availability(self, obj):
        return obj.availability(sold=self._sold(obj))

    def get_allowed_gate_names(self, obj):
        return [g.name for g in obj.allowed_gates.all()]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Give the ticket type a name.')
        return value

    def validate_price(self, value):
        if value < 0:
            raise serializers.ValidationError("Price can't be negative.")
        return value

    def validate_allowed_gates(self, gates):
        event = self.context['event']
        if any(g.event_id != event.id for g in gates):
            raise serializers.ValidationError("Those gates don't belong to this event.")
        return gates

    def validate(self, attrs):
        start = attrs.get('sales_start', getattr(self.instance, 'sales_start', None))
        end = attrs.get('sales_end', getattr(self.instance, 'sales_end', None))
        if start and end and end <= start:
            raise serializers.ValidationError({'sales_end': 'Sales must end after they start.'})
        quantity = attrs.get('quantity', getattr(self.instance, 'quantity', None))
        if self.instance and quantity is not None and quantity < self.instance.sold_count:
            raise serializers.ValidationError(
                {'quantity': f'{self.instance.sold_count} already registered with this ticket. Set at least that many.'}
            )
        return attrs


def public_ticket_type(t, sold=None, hide_counts=False):
    """What attendees see on the event page."""
    sold = t.sold_count if sold is None else sold
    return {
        'id': str(t.id),
        'name': t.name,
        'description': t.description,
        'price': str(t.price),
        'remaining': None if t.quantity is None or hide_counts else max(0, t.quantity - sold),
        'sales_start': t.sales_start.isoformat() if t.sales_start else None,
        'sales_end': t.sales_end.isoformat() if t.sales_end else None,
        'availability': t.availability(sold=sold),
        'note': t.gate_note,
        'online_only': t.online_only,
    }


class PromoCodeSerializer(serializers.ModelSerializer):
    used = serializers.SerializerMethodField()
    ticket_types = serializers.PrimaryKeyRelatedField(many=True, queryset=TicketType.objects.all(), required=False)

    class Meta:
        model = PromoCode
        fields = [
            'id', 'code', 'discount_type', 'discount_value', 'ticket_types', 'max_uses',
            'valid_from', 'valid_until', 'is_active', 'used', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def get_used(self, obj):
        return obj.used_count

    def validate_code(self, value):
        code = value.strip().upper()
        if not code or not code.replace('-', '').replace('_', '').isalnum():
            raise serializers.ValidationError('Use letters, numbers, - or _ only, e.g. STUDENT20.')
        event = self.context['event']
        clash = PromoCode.objects.filter(event=event, code=code)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(f'{code} already exists for this event.')
        return code

    def validate_ticket_types(self, types):
        event = self.context['event']
        if any(t.event_id != event.id for t in types):
            raise serializers.ValidationError("Those ticket types don't belong to this event.")
        return types

    def validate(self, attrs):
        kind = attrs.get('discount_type', getattr(self.instance, 'discount_type', PromoCode.DiscountType.PERCENT))
        value = attrs.get('discount_value', getattr(self.instance, 'discount_value', 0))
        if kind == PromoCode.DiscountType.PERCENT and not (0 < value <= 100):
            raise serializers.ValidationError({'discount_value': 'Percent off must be between 1 and 100.'})
        if kind == PromoCode.DiscountType.AMOUNT and value <= 0:
            raise serializers.ValidationError({'discount_value': 'Amount off must be more than 0.'})
        if kind == PromoCode.DiscountType.NONE:
            attrs['discount_value'] = 0
        return attrs


# ---------- Pricing & validation shared with registration ----------

class TicketError(Exception):
    def __init__(self, message, code=status.HTTP_400_BAD_REQUEST):
        super().__init__(message)
        self.message, self.code = message, code


def find_promo(event, code, now=None):
    """Valid promo code for the event, or raise TicketError."""
    now = now or timezone.now()
    promo = PromoCode.objects.filter(event=event, code=(code or '').strip().upper()).prefetch_related('ticket_types').first()
    if not promo or not promo.is_active:
        raise TicketError("That promo code isn't valid for this event.")
    if promo.valid_from and now < promo.valid_from:
        raise TicketError("That promo code isn't active yet.")
    if promo.valid_until and now > promo.valid_until:
        raise TicketError('That promo code has expired.')
    if promo.max_uses is not None and promo.used_count >= promo.max_uses:
        raise TicketError('That promo code has been fully used.')
    return promo


def promo_applies(promo, ticket_type):
    linked = list(promo.ticket_types.all())
    return not linked or ticket_type in linked


def discounted_price(ticket_type, promo):
    price = ticket_type.price
    if not promo or not promo_applies(promo, ticket_type):
        return _money(price)
    if promo.discount_type == PromoCode.DiscountType.PERCENT:
        price = price * (Decimal('100') - promo.discount_value) / Decimal('100')
    elif promo.discount_type == PromoCode.DiscountType.AMOUNT:
        price = price - promo.discount_value
    return _money(max(Decimal('0'), price))


def resolve_ticket_choice(event, ticket_type_id, promo_code_text, now=None):
    """Pick and lock the ticket type for a registration. Returns (ticket_type, promo, price).

    Must run inside transaction.atomic(): the ticket type row is locked so its quantity can't oversell.
    Events without ticket types return (None, None, 0) and keep working as before.
    """
    now = now or timezone.now()
    types = TicketType.objects.filter(event=event)
    if not types.exists():
        return None, None, Decimal('0')

    promo = find_promo(event, promo_code_text, now) if promo_code_text else None

    if ticket_type_id:
        ticket_type = types.select_for_update().filter(id=ticket_type_id).first()
        if not ticket_type:
            raise TicketError('Choose a ticket type.')
    else:
        # A single available public type is chosen automatically, so simple events need no picker.
        open_types = [t for t in types.filter(is_hidden=False) if t.availability(now) == 'on_sale']
        if len(open_types) != 1:
            raise TicketError('Choose a ticket type.' if open_types else 'Tickets are not on sale right now.')
        ticket_type = types.select_for_update().get(pk=open_types[0].pk)

    _check_type(ticket_type, promo, now)
    if promo and not promo_applies(promo, ticket_type):
        raise TicketError(f"That promo code doesn't apply to {ticket_type.name} tickets.")

    return ticket_type, promo, discounted_price(ticket_type, promo)


def _check_type(ticket_type, promo, now, quantity=1, already_taken=0):
    """Raise TicketError unless `quantity` more tickets of this type can be sold right now."""
    state = ticket_type.availability(now)
    messages = {
        'inactive': f'{ticket_type.name} tickets are not available.',
        'not_started': f'{ticket_type.name} tickets go on sale {timezone.localtime(ticket_type.sales_start):%d %b, %I:%M %p}.'
        if ticket_type.sales_start else '',
        'ended': f'{ticket_type.name} sales have ended.',
        'sold_out': f'{ticket_type.name} tickets are sold out.',
    }
    if state != 'on_sale':
        raise TicketError(messages[state], status.HTTP_409_CONFLICT if state == 'sold_out' else status.HTTP_400_BAD_REQUEST)
    if ticket_type.is_hidden and not (promo and ticket_type in promo.ticket_types.all()):
        raise TicketError(f'{ticket_type.name} needs a promo code.')
    if ticket_type.quantity is not None:
        left = ticket_type.quantity - ticket_type.sold_count - already_taken
        if quantity > left:
            raise TicketError(f'Only {max(left, 0)} {ticket_type.name} ticket{"" if left == 1 else "s"} left.',
                              status.HTTP_409_CONFLICT)


def default_ticket_type_id(event, now=None):
    """The only on-sale public ticket type, so simple events need no picker; None when there's a choice."""
    now = now or timezone.now()
    open_types = [t for t in TicketType.objects.filter(event=event, is_hidden=False) if t.availability(now) == 'on_sale']
    return open_types[0].id if len(open_types) == 1 else None


def resolve_order(event, items, promo_code_text, now=None):
    """Price and lock a multi-ticket order. Returns (lines, promo) where lines is one
    (ticket_type, price) per ticket, in order. Must run inside transaction.atomic().

    `items` is [{ticket_type_id, quantity}]. Events without ticket types sell untyped free tickets.
    The promo discount applies to each eligible ticket; it must apply to at least one of them.
    """
    now = now or timezone.now()
    limit = max(1, event.max_tickets_per_order or 1)
    total = sum(item['quantity'] for item in items)
    if total < 1:
        raise TicketError('Choose at least one ticket.')
    if total > limit:
        raise TicketError(f'You can get up to {limit} ticket{"" if limit == 1 else "s"} per order.')

    types = TicketType.objects.filter(event=event)
    if not types.exists():
        return [(None, Decimal('0'))] * total, None

    promo = find_promo(event, promo_code_text, now) if promo_code_text else None
    lines, taken = [], {}
    for item in items:
        if not item.get('ticket_type_id'):
            raise TicketError('Choose a ticket type.')
        tt = types.select_for_update().filter(id=item['ticket_type_id']).first()
        if not tt:
            raise TicketError('Choose a ticket type.')
        _check_type(tt, promo, now, item['quantity'], taken.get(tt.id, 0))
        taken[tt.id] = taken.get(tt.id, 0) + item['quantity']
        lines += [(tt, discounted_price(tt, promo))] * item['quantity']

    if promo and not any(promo_applies(promo, tt) for tt, _ in lines):
        names = ', '.join(sorted({tt.name for tt, _ in lines}))
        raise TicketError(f"That promo code doesn't apply to {names} tickets.")
    return lines, promo


def ticket_type_gate_error(ticket, gate):
    """Message when a ticket type isn't allowed through this gate, else None."""
    tt = ticket.ticket_type
    if not tt or not gate:
        return None
    allowed = list(tt.allowed_gates.all())
    if allowed and gate not in allowed:
        names = ', '.join(g.name for g in allowed)
        return f'{tt.name} tickets enter at {names}, not {gate.name}.'
    return None


# ---------- Presets: one click to a sensible setup ----------

def _sales_end_before(event, days):
    """End of day `days` before the event, or None if that's already past."""
    end = timezone.make_aware(datetime.combine(event.start_date - timedelta(days=days), time(23, 59)))
    return end if end > timezone.now() else None


def _preset_rows(preset, base, event):
    base = _money(base)
    early_end = _sales_end_before(event, 7)
    vip_gates = list(event.gates.filter(is_vip=True, is_active=True))
    general = {'name': 'General', 'price': base, 'description': 'Standard entry'}
    early = {'name': 'Early Bird', 'price': _money(base * Decimal('0.8')), 'quantity': 50, 'sales_end': early_end,
             'description': 'Limited early price'}
    student = {'name': 'Student', 'price': _money(base * Decimal('0.5')), 'gate_note': 'Check student ID',
               'description': 'Valid student ID required at entry'}
    vip = {'name': 'VIP', 'price': _money(base * 2), 'description': 'Priority entry', 'gates': vip_gates}
    return {
        'free': [{'name': 'Free entry', 'price': Decimal('0'), 'description': 'Free registration'}],
        'general': [general],
        'early_bird': [early, general],
        'student': [student, general],
        'vip': [general, vip],
        'full': [early, student, general, vip],
    }.get(preset)


PRESETS = ['free', 'general', 'early_bird', 'student', 'vip', 'full']


# ---------- Organizer views ----------

def _event_for_manager(request, event_id):
    event = get_object_or_404(Event, id=event_id)
    if not _can_manage(request.user, event):
        return event, Response({'error': 'Only the event organizer can manage tickets.'}, status=status.HTTP_403_FORBIDDEN)
    return event, None


def _types_with_counts(event):
    return (
        event.ticket_types.prefetch_related('allowed_gates')
        .annotate(sold=Count('tickets', filter=~Q(tickets__status=EventTicket.Status.CANCELLED)))
        .order_by('order', 'created_at')  # Meta.ordering is dropped on aggregate queries
    )


class TicketTypeListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        event, err = _event_for_manager(request, event_id)
        if err:
            return err
        return Response(TicketTypeSerializer(_types_with_counts(event), many=True, context={'event': event}).data)

    def post(self, request, event_id):
        event, err = _event_for_manager(request, event_id)
        if err:
            return err
        s = TicketTypeSerializer(data=request.data, context={'event': event})
        s.is_valid(raise_exception=True)
        order = (event.ticket_types.order_by('-order').values_list('order', flat=True).first() or 0) + 1
        tt = s.save(event=event, order=request.data.get('order') or order)
        sync_event_price(event)
        return Response(TicketTypeSerializer(tt, context={'event': event}).data, status=status.HTTP_201_CREATED)


class TicketTypeDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def _get(self, request, event_id, type_id):
        event, err = _event_for_manager(request, event_id)
        if err:
            return event, None, err
        return event, get_object_or_404(TicketType, id=type_id, event=event), None

    def patch(self, request, event_id, type_id):
        event, tt, err = self._get(request, event_id, type_id)
        if err:
            return err
        s = TicketTypeSerializer(tt, data=request.data, partial=True, context={'event': event})
        s.is_valid(raise_exception=True)
        tt = s.save()
        sync_event_price(event)
        return Response(TicketTypeSerializer(tt, context={'event': event}).data)

    def delete(self, request, event_id, type_id):
        event, tt, err = self._get(request, event_id, type_id)
        if err:
            return err
        if tt.sold_count:
            # Keep it for existing passes; just stop selling it.
            tt.is_active = False
            tt.save(update_fields=['is_active'])
            sync_event_price(event)
            return Response({'deleted': False, 'deactivated': True,
                             'message': f'{tt.name} has registrations, so it was turned off instead of deleted.'})
        tt.delete()
        sync_event_price(event)
        return Response({'deleted': True, 'deactivated': False, 'message': f'{tt.name} deleted.'})


class TicketPresetView(APIView):
    """Replace unsold ticket types with a ready-made set, priced from one base price."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, event_id):
        event, err = _event_for_manager(request, event_id)
        if err:
            return err
        preset = request.data.get('preset')
        if preset not in PRESETS:
            return Response({'error': f"Pick one of: {', '.join(PRESETS)}."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            base = Decimal(str(request.data.get('base_price') or 0))
        except Exception:
            return Response({'error': 'Enter a valid price.'}, status=status.HTTP_400_BAD_REQUEST)
        if preset != 'free' and base <= 0:
            return Response({'error': 'Enter the normal ticket price, e.g. 500.'}, status=status.HTTP_400_BAD_REQUEST)

        rows = _preset_rows(preset, base, event)
        with transaction.atomic():
            kept = []
            for tt in event.ticket_types.all():
                if tt.sold_count:
                    tt.is_active = False  # keep for existing passes
                    tt.save(update_fields=['is_active'])
                    kept.append(tt.name)
                else:
                    tt.delete()
            for i, row in enumerate(rows):
                gates = row.pop('gates', [])
                tt = TicketType.objects.create(event=event, order=i + 1, **row)
                if gates:
                    tt.allowed_gates.set(gates)
        sync_event_price(event)
        data = TicketTypeSerializer(_types_with_counts(event), many=True, context={'event': event}).data
        return Response({'ticket_types': data, 'kept_inactive': kept})


class PromoCodeListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        event, err = _event_for_manager(request, event_id)
        if err:
            return err
        codes = event.promo_codes.prefetch_related('ticket_types')
        return Response(PromoCodeSerializer(codes, many=True, context={'event': event}).data)

    def post(self, request, event_id):
        event, err = _event_for_manager(request, event_id)
        if err:
            return err
        s = PromoCodeSerializer(data=request.data, context={'event': event})
        s.is_valid(raise_exception=True)
        promo = s.save(event=event)
        return Response(PromoCodeSerializer(promo, context={'event': event}).data, status=status.HTTP_201_CREATED)


class PromoCodeDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def _get(self, request, event_id, code_id):
        event, err = _event_for_manager(request, event_id)
        if err:
            return event, None, err
        return event, get_object_or_404(PromoCode, id=code_id, event=event), None

    def patch(self, request, event_id, code_id):
        event, promo, err = self._get(request, event_id, code_id)
        if err:
            return err
        s = PromoCodeSerializer(promo, data=request.data, partial=True, context={'event': event})
        s.is_valid(raise_exception=True)
        return Response(PromoCodeSerializer(s.save(), context={'event': event}).data)

    def delete(self, request, event_id, code_id):
        event, promo, err = self._get(request, event_id, code_id)
        if err:
            return err
        if promo.used_count:
            promo.is_active = False
            promo.save(update_fields=['is_active'])
            return Response({'deleted': False, 'deactivated': True,
                             'message': f'{promo.code} was used, so it was turned off instead of deleted.'})
        promo.delete()
        return Response({'deleted': True, 'deactivated': False, 'message': f'{promo.code} deleted.'})


# ---------- Public ----------

def public_ticket_types(event):
    return [public_ticket_type(t, t.sold, not event.show_spots_left) for t in _types_with_counts(event).filter(is_hidden=False, is_active=True)]


class PublicPromoCheckView(APIView):
    """Attendee enters a code on the registration page: returns discounted prices and unlocked types."""
    permission_classes = [permissions.AllowAny]

    def post(self, request, slug):
        from apps.accounts.tenancy import scope_events
        event = get_object_or_404(scope_events(Event.objects.all(), request), slug=slug,
                                  status__in=[Event.Status.PUBLISHED, Event.Status.ONGOING])
        try:
            promo = find_promo(event, request.data.get('code'))
        except TicketError as e:
            return Response({'valid': False, 'error': e.message}, status=e.code)
        types = _types_with_counts(event).filter(is_active=True)
        out = []
        for t in types:
            if t.is_hidden and t not in promo.ticket_types.all():
                continue
            row = public_ticket_type(t, t.sold, not event.show_spots_left)
            row['discounted_price'] = str(discounted_price(t, promo))
            row['promo_applies'] = promo_applies(promo, t)
            row['unlocked'] = t.is_hidden
            out.append(row)
        if promo.discount_type == PromoCode.DiscountType.PERCENT:
            label = f'{promo.discount_value.normalize():f}% off'
        elif promo.discount_type == PromoCode.DiscountType.AMOUNT:
            label = f'Rs {promo.discount_value.normalize():f} off'
        else:
            label = 'Special tickets unlocked'
        return Response({'valid': True, 'code': promo.code, 'label': label, 'ticket_types': out})


def ticket_type_breakdown(event):
    """Per-type registrations, check-ins and amount due at the venue (for analytics)."""
    rows = []
    for t in event.ticket_types.annotate(
        sold=Count('tickets', filter=~Q(tickets__status=EventTicket.Status.CANCELLED)),
        checked_in=Count('tickets', filter=Q(tickets__is_attended=True)),
    ).order_by('order', 'created_at'):
        revenue = sum((tk.price for tk in t.tickets.exclude(status=EventTicket.Status.CANCELLED)), Decimal('0'))
        rows.append({
            'id': str(t.id), 'name': t.name, 'price': str(t.price), 'quantity': t.quantity,
            'sold': t.sold, 'checked_in': t.checked_in, 'revenue': str(_money(revenue)),
            'availability': t.availability(sold=t.sold), 'is_hidden': t.is_hidden,
        })
    return rows
