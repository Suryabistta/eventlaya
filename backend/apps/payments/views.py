"""HTTP endpoints for online payments (mounted at /api/payments/). See docs/payments.md."""
import csv
from datetime import datetime
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.http import HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.html import escape
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.modules import module_enabled

from . import services
from .models import PaymentIntent, PaymentSettings, Payout
from .providers import available_providers, decode_esewa_response, provider_status
from .services import PaymentError

S = PaymentIntent.Status


def payments_on(user=None):
    return module_enabled('payments', user)


class IsSuperadmin(permissions.BasePermission):
    message = 'Only platform admins can do this.'

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superadmin)


class IsOrganizer(permissions.BasePermission):
    message = 'Only organizers can see payments.'

    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and (u.is_superadmin or u.role == 'organizer'))


# ---------------------------------------------------------------------------
# Public: providers, status, checkout, provider returns
# ---------------------------------------------------------------------------

class ProvidersView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        on = payments_on(request.user)
        return Response({'enabled': on, 'providers': [p.public() for p in available_providers()] if on else []})


class IntentStatusView(APIView):
    """GET /api/payments/intents/<id>/ — the payer polls this after coming back from the provider."""
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request, intent_id):
        intent = get_object_or_404(PaymentIntent, pk=intent_id)
        return Response(services.public_intent(services.refresh(intent)))


class IntentCheckoutView(APIView):
    """POST {provider} — start (or resume) the checkout for an open intent."""
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request, intent_id):
        intent = get_object_or_404(PaymentIntent, pk=intent_id)
        try:
            checkout = services.start_checkout(intent, request.data.get('provider') or '', request)
        except PaymentError as e:
            return Response({'error': e.message}, status=e.code)
        intent.refresh_from_db()
        return Response({'payment': services.public_intent(intent), 'checkout': checkout})


def _redirect(intent):
    return HttpResponseRedirect(services.frontend_redirect(PaymentIntent.objects.get(pk=intent.pk)))


class KhaltiReturnView(APIView):
    """Khalti sends the payer back here with ?pidx=&status=&purchase_order_id=... — we look it up ourselves."""
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request, intent_id):
        intent = get_object_or_404(PaymentIntent, pk=intent_id, provider='khalti')
        params = {k: request.query_params.get(k, '') for k in
                  ('pidx', 'status', 'transaction_id', 'amount', 'total_amount', 'purchase_order_id')}
        services.log(intent, 'return', f"Khalti return: {params['status'] or '-'}", params)
        if params['pidx'] and params['pidx'] != intent.provider_ref or (
                params['purchase_order_id'] and params['purchase_order_id'] != str(intent.id)):
            services.log(intent, 'tamper', 'Return parameters do not match this payment', params)
        # The lookup is authoritative (a "Completed" in the URL proves nothing; "User canceled" closes it
        # only when the lookup agrees)
        return _redirect(services.verify(intent, 'Khalti return'))


class EsewaReturnView(APIView):
    """eSewa success_url (?data=<base64 signed JSON>) and failure_url. The status API decides."""
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request, intent_id, outcome):
        intent = get_object_or_404(PaymentIntent, pk=intent_id, provider='esewa')
        encoded = request.query_params.get('data', '')
        if encoded:
            data, signature_ok = decode_esewa_response(encoded)
            services.log(intent, 'return', f'eSewa {outcome}: {data.get("status", "-")}', {**data, 'signature_ok': signature_ok})
            problems = []
            if not signature_ok:
                problems.append('bad signature')
            if data.get('transaction_uuid') and data['transaction_uuid'] != intent.provider_ref:
                problems.append('transaction_uuid mismatch')
            amount = services.money(str(data.get('total_amount', '0')).replace(',', '') or '0') if data else None
            if data.get('total_amount') and amount != intent.amount:
                problems.append(f'amount {amount} != {intent.amount}')
            if problems:
                services.log(intent, 'tamper', 'eSewa response rejected: ' + ', '.join(problems))
        else:
            services.log(intent, 'return', f'eSewa {outcome} (no data)')
        intent = services.verify(intent, f'eSewa {outcome}')
        if outcome == 'failure' and intent.is_open:
            # Back on the failure URL and eSewa doesn't report it complete or pending: the payer gave up
            last = intent.logs.filter(kind='verify').order_by('-id').first()
            if last and last.data.get('state') in ('unknown', 'cancelled', 'failed'):
                intent = services.close(intent, S.CANCELLED, 'Cancelled at eSewa')
        return _redirect(intent)


class TestReturnView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request, intent_id):
        intent = get_object_or_404(PaymentIntent, pk=intent_id, provider='test')
        return _redirect(services.verify(intent, 'test return'))


@method_decorator(csrf_exempt, name='dispatch')
class TestCheckoutPage(APIView):
    """The test provider's 'payment page' (DEBUG or PAYMENTS_TEST_PROVIDER=1 only)."""
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def _intent(self, intent_id):
        from django.conf import settings
        if not getattr(settings, 'PAYMENTS_TEST_PROVIDER', False):
            return None
        return PaymentIntent.objects.filter(pk=intent_id, provider='test').first()

    def get(self, request, intent_id):
        intent = self._intent(intent_id)
        if intent is None:
            return HttpResponse('Not found', status=404)
        html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test payment</title><style>
body{{font-family:system-ui,sans-serif;background:#f4f1f6;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;color:#1c1724}}
.card{{background:#fff;border-radius:18px;padding:28px;max-width:380px;width:calc(100% - 32px);box-shadow:0 10px 30px rgba(0,0,0,.08)}}
.tag{{display:inline-block;background:#fff4d6;color:#7a4b00;font-size:12px;font-weight:700;padding:4px 10px;border-radius:99px}}
h1{{font-size:20px;margin:12px 0 4px}} .amt{{font-size:32px;font-weight:800;margin:16px 0}} p{{color:#5b5566;font-size:14px;margin:4px 0}}
button{{width:100%;padding:13px;border-radius:12px;border:0;font-size:15px;font-weight:700;margin-top:10px;cursor:pointer}}
.pay{{background:#16a34a;color:#fff}} .fail{{background:#fee2e2;color:#991b1b}} .cancel{{background:#eee;color:#333}}
</style></head><body><form class="card" method="post">
<span class="tag">TEST MODE · no real money</span>
<h1>{escape(intent.description)}</h1><p>{escape(intent.payer_name)} · {escape(intent.payer_email)}</p>
<div class="amt">Rs {intent.amount:,.2f}</div><p>Reference {escape(intent.provider_ref)}</p>
<button class="pay" name="outcome" value="paid">Pay Rs {intent.amount:,.2f}</button>
<button class="fail" name="outcome" value="failed">Simulate a failed payment</button>
<button class="cancel" name="outcome" value="cancelled">Cancel and go back</button>
</form></body></html>"""
        return HttpResponse(html)

    def post(self, request, intent_id):
        intent = self._intent(intent_id)
        if intent is None:
            return HttpResponse('Not found', status=404)
        outcome = request.POST.get('outcome') or request.data.get('outcome')
        if outcome not in ('paid', 'failed', 'cancelled'):
            return HttpResponse('Bad outcome', status=400)
        meta = dict(intent.metadata or {})
        meta['_test_outcome'] = outcome
        PaymentIntent.objects.filter(pk=intent.pk).update(metadata=meta)
        return HttpResponseRedirect(f'/api/payments/return/test/{intent.id}/')


# ---------------------------------------------------------------------------
# The payer's own history (signed in): GET /api/payments/mine/
# ---------------------------------------------------------------------------

def _summary(intent):
    """Short, payer-safe description of what the payment bought (no tokens, no provider responses)."""
    from .registry import get_purpose
    purpose = get_purpose(intent.purpose)
    if purpose is None or purpose.describe is None:
        return None
    try:
        r = purpose.describe(intent) or {}
    except Exception:  # noqa: BLE001
        return None
    if r.get('type') == 'ticket_order':
        order = r.get('order') or {}
        return {'type': 'ticket_order', 'order_reference': order.get('reference'), 'ticket_count': order.get('ticket_count'),
                'tickets_issued': len(r.get('tickets') or []), 'needs_attention': r.get('needs_attention')}
    if r.get('type') == 'vote_pack':
        p = r.get('purchase') or {}
        c = r.get('contest') or {}
        return {'type': 'vote_pack', 'votes': p.get('total_votes'), 'label': p.get('label'), 'credited': bool(r.get('credited')),
                'auto_voted': p.get('auto_voted') or 0, 'contestant': (p.get('contestant') or {}).get('name'),
                'contest': {'title': c.get('title'), 'slug': c.get('slug'), 'event_slug': c.get('event_slug')} if c else None}
    return {'type': r.get('type') or intent.purpose}


def payer_row(i):
    from .registry import get_purpose
    purpose = get_purpose(i.purpose)
    return {
        'id': str(i.id), 'purpose': i.purpose, 'purpose_label': purpose.label if purpose else i.purpose,
        'description': i.description, 'status': i.status, 'amount': str(i.amount), 'currency': i.currency,
        'provider': i.provider or None, 'provider_name': i.get_provider_display() if i.provider else None,
        'provider_txn_id': i.provider_txn_id or None,
        'event': {'title': i.event.title, 'slug': i.event.slug} if i.event_id else None,
        'created_at': i.created_at, 'paid_at': i.paid_at, 'expires_at': i.expires_at,
        'refunded': i.status == S.REFUNDED, 'refunded_at': i.refunded_at,
        'fulfilled': bool(i.fulfilled_at), 'failure_reason': i.failure_reason or None,
        'summary': _summary(i),
    }


class MyPaymentsView(APIView):
    """GET — the signed-in payer's online payments on every device, newest first (?limit=&offset=).

    Payments made while signed in (intent.user), plus — when the account's email is verified — those paid
    signed out with that email. Never anyone else's; abandoned checkouts (status created) are left out."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        mine = Q(user=user)
        if getattr(user, 'email_verified', False) and user.email:
            mine |= Q(payer_email__iexact=user.email)
        qs = PaymentIntent.objects.filter(mine).exclude(status=S.CREATED).select_related('event').order_by('-created_at')
        try:
            limit = min(100, max(1, int(request.query_params.get('limit', 50))))
            offset = max(0, int(request.query_params.get('offset', 0)))
        except ValueError:
            limit, offset = 50, 0
        return Response({'count': qs.count(), 'results': [payer_row(i) for i in qs[offset:offset + limit]]})


# ---------------------------------------------------------------------------
# Lists, CSV, refunds (organizer + superadmin)
# ---------------------------------------------------------------------------

def _filter(qs, params):
    if params.get('event'):
        qs = qs.filter(event_id=params['event'])
    if params.get('status'):
        qs = qs.filter(status__in=params['status'].split(','))
    else:
        # Abandoned checkouts are noise in reports unless asked for
        qs = qs.exclude(status=S.CREATED)
    if params.get('provider'):
        qs = qs.filter(provider=params['provider'])
    if params.get('purpose'):
        qs = qs.filter(purpose=params['purpose'])
    if params.get('organizer'):
        qs = qs.filter(organizer_id=params['organizer'])
    for key, lookup in (('from', 'created_at__date__gte'), ('to', 'created_at__date__lte')):
        if params.get(key):
            try:
                qs = qs.filter(**{lookup: datetime.strptime(params[key], '%Y-%m-%d').date()})
            except ValueError:
                pass
    q = (params.get('search') or '').strip()
    if q:
        qs = qs.filter(Q(payer_name__icontains=q) | Q(payer_email__icontains=q) | Q(provider_ref__icontains=q)
                       | Q(provider_txn_id__icontains=q) | Q(description__icontains=q) | Q(reference__icontains=q))
    return qs


def intent_row(i, admin=False):
    row = {
        'id': str(i.id), 'purpose': i.purpose, 'reference': i.reference, 'description': i.description,
        'status': i.status, 'amount': str(i.amount), 'provider': i.provider or None,
        'provider_name': i.get_provider_display() if i.provider else None,
        'provider_ref': i.provider_ref, 'provider_txn_id': i.provider_txn_id,
        'platform_fee_percent': str(i.platform_fee_percent), 'platform_fee': str(i.platform_fee),
        'net_amount': str(i.net_amount if i.status in (S.PAID, S.REFUNDED) else Decimal('0')),
        'payer_name': i.payer_name, 'payer_email': i.payer_email, 'payer_phone': i.payer_phone,
        'event': {'id': str(i.event_id), 'title': i.event.title} if i.event_id else None,
        'order_reference': (i.metadata or {}).get('order_reference'),
        'created_at': i.created_at, 'paid_at': i.paid_at, 'refunded_at': i.refunded_at, 'expires_at': i.expires_at,
        'refund_note': i.refund_note, 'failure_reason': i.failure_reason,
    }
    if admin:
        org = i.organizer
        row['organizer'] = {'id': str(org.id), 'name': org.organization_name or org.get_full_name() or org.email} if org else None
    return row


def _csv(qs, filename, admin=False):
    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    w = csv.writer(response)
    head = ['Created', 'Paid at', 'Status', 'Purpose', 'Description', 'Event', 'Order', 'Payer', 'Email', 'Phone',
            'Provider', 'Provider ref', 'Transaction id', 'Amount (NPR)', 'Platform fee %', 'Platform fee', 'Net to organizer',
            'Refunded at', 'Refund note']
    if admin:
        head.insert(6, 'Organizer')
    w.writerow(head)
    for i in qs.select_related('event', 'organizer'):
        r = intent_row(i, admin)
        line = [
            timezone.localtime(i.created_at).strftime('%Y-%m-%d %H:%M'),
            timezone.localtime(i.paid_at).strftime('%Y-%m-%d %H:%M') if i.paid_at else '',
            i.status, i.purpose, i.description, r['event']['title'] if r['event'] else '', r['order_reference'] or '',
            i.payer_name, i.payer_email, i.payer_phone, r['provider_name'] or '', i.provider_ref, i.provider_txn_id,
            i.amount, i.platform_fee_percent, i.platform_fee, r['net_amount'],
            timezone.localtime(i.refunded_at).strftime('%Y-%m-%d %H:%M') if i.refunded_at else '', i.refund_note,
        ]
        if admin:
            line.insert(6, r['organizer']['name'] if r['organizer'] else '')
        w.writerow(line)
    return response


def _page(request, qs, admin=False):
    try:
        limit = min(200, max(1, int(request.query_params.get('limit', 50))))
        offset = max(0, int(request.query_params.get('offset', 0)))
    except ValueError:
        limit, offset = 50, 0
    rows = qs.select_related('event', 'organizer')[offset:offset + limit]
    return {'count': qs.count(), 'results': [intent_row(i, admin) for i in rows]}


def totals(qs):
    paid = qs.filter(status=S.PAID).aggregate(n=Count('id'), gross=Sum('amount'), fee=Sum('platform_fee'))
    refunded = qs.filter(status=S.REFUNDED).aggregate(n=Count('id'), gross=Sum('amount'))
    gross, fee = services.money(paid['gross'] or 0), services.money(paid['fee'] or 0)
    return {
        'paid_count': paid['n'], 'collected': str(gross), 'platform_fee': str(fee), 'net': str(gross - fee),
        'refunded_count': refunded['n'], 'refunded': str(services.money(refunded['gross'] or 0)),
        'pending_count': qs.filter(status__in=PaymentIntent.OPEN).exclude(status=S.CREATED).count(),
    }


def per_event(qs, payouts):
    """Collected online per event: gross, platform fee, net owed, paid out."""
    rows = {}
    for r in (qs.filter(status=S.PAID).values('event_id', 'event__title', 'organizer_id')
              .annotate(n=Count('id'), gross=Sum('amount'), fee=Sum('platform_fee')).order_by('-gross')):
        rows[r['event_id']] = {
            'event': {'id': str(r['event_id']), 'title': r['event__title']} if r['event_id'] else None,
            'payments': r['n'], 'collected': services.money(r['gross'] or 0), 'platform_fee': services.money(r['fee'] or 0),
            'paid_out': Decimal('0.00'),
        }
    for p in payouts.values('event_id', 'event__title').annotate(total=Sum('amount')):
        row = rows.setdefault(p['event_id'], {
            'event': {'id': str(p['event_id']), 'title': p['event__title']} if p['event_id'] else None,
            'payments': 0, 'collected': Decimal('0.00'), 'platform_fee': Decimal('0.00'), 'paid_out': Decimal('0.00'),
        })
        row['paid_out'] += services.money(p['total'] or 0)
    out = []
    for row in rows.values():
        net = row['collected'] - row['platform_fee']
        out.append({**row, 'collected': str(row['collected']), 'platform_fee': str(row['platform_fee']),
                    'net': str(net), 'paid_out': str(row['paid_out']), 'owed': str(net - row['paid_out'])})
    return out


def payout_row(p):
    org = p.organizer
    return {
        'id': str(p.id), 'amount': str(p.amount), 'method': p.method, 'method_label': p.get_method_display(),
        'reference': p.reference, 'note': p.note, 'paid_on': p.paid_on,
        'event': {'id': str(p.event_id), 'title': p.event.title} if p.event_id else None,
        'organizer': {'id': str(org.id), 'name': org.organization_name or org.get_full_name() or org.email},
        'created_at': p.created_at,
    }


class OrganizerPaymentsView(APIView):
    """GET — the organizer's online payments. ?event=&status=&provider=&purpose=&from=&to=&search=&export=csv"""
    permission_classes = [IsOrganizer]

    def get(self, request):
        qs = _filter(PaymentIntent.objects.filter(organizer=request.user), request.query_params)
        if request.query_params.get('export') == 'csv':
            return _csv(qs, 'eventlaya_online_payments.csv')
        data = _page(request, qs)
        data['totals'] = totals(qs)
        return Response(data)


class OrganizerSummaryView(APIView):
    """GET — collected online per event, platform fee, paid out and still owed to the organizer."""
    permission_classes = [IsOrganizer]

    def get(self, request):
        qs = PaymentIntent.objects.filter(organizer=request.user)
        payouts = Payout.objects.filter(organizer=request.user)
        paid_out = services.money(payouts.aggregate(t=Sum('amount'))['t'] or 0)
        t = totals(qs)
        return Response({
            'totals': {**t, 'paid_out': str(paid_out), 'owed': str(Decimal(t['net']) - paid_out)},
            'events': per_event(qs, payouts),
            'payouts': [payout_row(p) for p in payouts.select_related('event', 'organizer')[:50]],
            'providers': [p.public() for p in available_providers()] if payments_on(request.user) else [],
            'platform_fee_percent': str(PaymentSettings.load().platform_fee_percent),
            'reservation_minutes': PaymentSettings.load().reservation_minutes,
        })


class IntentRefundView(APIView):
    """POST {note} — record a refund (the money goes back by hand from the merchant dashboard)."""
    permission_classes = [IsOrganizer]

    def post(self, request, intent_id):
        intent = get_object_or_404(PaymentIntent, pk=intent_id)
        if not (request.user.is_superadmin or intent.organizer_id == request.user.id):
            return Response({'error': 'This payment is not yours.'}, status=status.HTTP_403_FORBIDDEN)
        note = (request.data.get('note') or '').strip()
        if not note:
            return Response({'error': 'Add a note: how and when the money was returned.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            intent = services.mark_refunded(intent, request.user, note)
        except PaymentError as e:
            return Response({'error': e.message}, status=e.code)
        return Response(intent_row(intent))


# ---------------------------------------------------------------------------
# Superadmin
# ---------------------------------------------------------------------------

class AdminOverviewView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        qs = PaymentIntent.objects.all()
        payouts = Payout.objects.all()
        t = totals(qs)
        paid_out = services.money(payouts.aggregate(t=Sum('amount'))['t'] or 0)
        by_provider = [
            {'provider': r['provider'], 'payments': r['n'], 'collected': str(services.money(r['gross'] or 0))}
            for r in qs.filter(status=S.PAID).values('provider').annotate(n=Count('id'), gross=Sum('amount')).order_by('provider')
        ]
        organizers = []
        for r in (qs.filter(status=S.PAID).values('organizer_id', 'organizer__organization_name', 'organizer__email')
                  .annotate(n=Count('id'), gross=Sum('amount'), fee=Sum('platform_fee')).order_by('-gross')):
            out = services.money(payouts.filter(organizer_id=r['organizer_id']).aggregate(t=Sum('amount'))['t'] or 0)
            net = services.money(r['gross'] or 0) - services.money(r['fee'] or 0)
            organizers.append({
                'organizer': {'id': str(r['organizer_id']), 'name': r['organizer__organization_name'] or r['organizer__email']},
                'payments': r['n'], 'collected': str(services.money(r['gross'] or 0)), 'platform_fee': str(services.money(r['fee'] or 0)),
                'net': str(net), 'paid_out': str(out), 'owed': str(net - out),
            })
        attention = qs.filter(Q(status=S.PAID, fulfilled_at__isnull=True) | Q(logs__kind__in=['late_payment', 'tamper'])).distinct()
        s = PaymentSettings.load()
        return Response({
            'totals': {**t, 'paid_out': str(paid_out), 'owed': str(Decimal(t['net']) - paid_out)},
            'by_provider': by_provider,
            'organizers': organizers,
            'providers': provider_status(),
            'module_enabled': payments_on(None),
            'settings': {'platform_fee_percent': str(s.platform_fee_percent), 'reservation_minutes': s.reservation_minutes},
            'needs_attention': [intent_row(i, True) for i in attention.select_related('event', 'organizer')[:20]],
        })


class AdminPaymentsView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        qs = _filter(PaymentIntent.objects.all(), request.query_params)
        if request.query_params.get('export') == 'csv':
            return _csv(qs, 'eventlaya_all_online_payments.csv', admin=True)
        data = _page(request, qs, admin=True)
        data['totals'] = totals(qs)
        return Response(data)


class AdminPaymentDetailView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request, intent_id):
        intent = get_object_or_404(PaymentIntent.objects.select_related('event', 'organizer'), pk=intent_id)
        row = intent_row(intent, True)
        row['logs'] = [{'at': l.created_at, 'kind': l.kind, 'message': l.message, 'data': l.data,
                        'actor': l.actor.email if l.actor_id else None} for l in intent.logs.select_related('actor')]
        row['metadata'] = {k: v for k, v in (intent.metadata or {}).items() if not k.startswith('_')}
        return Response(row)

    def post(self, request, intent_id):
        """Re-check with the provider now."""
        intent = get_object_or_404(PaymentIntent, pk=intent_id)
        intent = services.verify(intent, f'admin re-check by {request.user.email}')
        return Response(intent_row(intent, True))


class AdminSettingsView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        s = PaymentSettings.load()
        return Response({'platform_fee_percent': str(s.platform_fee_percent), 'reservation_minutes': s.reservation_minutes})

    def put(self, request):
        s = PaymentSettings.load()
        errors = {}
        if 'platform_fee_percent' in request.data:
            try:
                pct = Decimal(str(request.data['platform_fee_percent']))
                if not (0 <= pct <= 50):
                    raise ValueError
                s.platform_fee_percent = pct.quantize(Decimal('0.01'))
            except Exception:  # noqa: BLE001
                errors['platform_fee_percent'] = 'Enter a percentage between 0 and 50.'
        if 'reservation_minutes' in request.data:
            try:
                minutes = int(request.data['reservation_minutes'])
                if not (5 <= minutes <= 60):
                    raise ValueError
                s.reservation_minutes = minutes
            except (TypeError, ValueError):
                errors['reservation_minutes'] = 'Hold tickets for 5 to 60 minutes.'
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        s.updated_by = request.user
        s.save()
        return self.get(request)


class AdminPayoutsView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        qs = Payout.objects.select_related('event', 'organizer')
        if request.query_params.get('organizer'):
            qs = qs.filter(organizer_id=request.query_params['organizer'])
        return Response([payout_row(p) for p in qs[:200]])

    def post(self, request):
        from django.contrib.auth import get_user_model
        from apps.events.models import Event
        d = request.data
        organizer = get_user_model().objects.filter(pk=d.get('organizer')).first()
        if organizer is None:
            return Response({'organizer': 'Choose the organizer.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            amount = Decimal(str(d.get('amount')))
            if amount <= 0:
                raise ValueError
        except Exception:  # noqa: BLE001
            return Response({'amount': 'Enter the amount paid out.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            paid_on = datetime.strptime(d.get('paid_on') or timezone.localdate().isoformat(), '%Y-%m-%d').date()
        except ValueError:
            return Response({'paid_on': 'Use a date like 2026-10-28.'}, status=status.HTTP_400_BAD_REQUEST)
        event = Event.objects.filter(pk=d.get('event'), organizer=organizer).first() if d.get('event') else None
        method = d.get('method') if d.get('method') in Payout.Method.values else Payout.Method.BANK
        p = Payout.objects.create(organizer=organizer, event=event, amount=amount.quantize(Decimal('0.01')), method=method,
                                  reference=(d.get('reference') or '')[:120], note=d.get('note') or '', paid_on=paid_on,
                                  created_by=request.user)
        return Response(payout_row(p), status=status.HTTP_201_CREATED)


class AdminPayoutDetailView(APIView):
    permission_classes = [IsSuperadmin]

    def delete(self, request, payout_id):
        get_object_or_404(Payout, pk=payout_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
