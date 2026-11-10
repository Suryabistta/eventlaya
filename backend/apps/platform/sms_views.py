"""SMS credits API (module `sms`, apps.platform.sms_credits).

GET  /api/platform/sms/mine/                       organizer: balance, plan allowance, history, requests
POST /api/platform/sms/requests/                   organizer: {credits, note} ask for more
GET  /api/platform/sms/requests/?status=pending    superadmin: requests (pending | approved | declined | all)
POST /api/platform/sms/requests/<id>/approve/      superadmin: {credits?, note?} add the credits
POST /api/platform/sms/requests/<id>/decline/      superadmin: {note} with a reason
GET  /api/platform/sms/orgs/<org id>/              superadmin: an organization's balance and history
POST /api/platform/sms/orgs/<org id>/              superadmin: {credits, note} add (or take back, negative) credits
"""
from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .billing import ORG_ROLES, get_subscription
from .models import SmsCreditEntry, SmsCreditRequest
from .sms_credits import add_credits, balance
from .views import IsSuperadmin, display_name

User = get_user_model()
MAX_REQUEST = 100_000
PACKS = [500, 1000, 2500, 5000]


def _err(msg, code=status.HTTP_400_BAD_REQUEST):
    return Response({'error': msg}, status=code)


def entry_dict(e):
    return {'id': str(e.id), 'kind': e.kind, 'kind_display': e.get_kind_display(), 'credits': e.credits, 'note': e.note,
            'created_at': e.created_at}


def request_dict(r):
    return {
        'id': str(r.id), 'organization_id': str(r.organization_id), 'organization_name': display_name(r.organization),
        'organization_email': r.organization.email, 'credits': r.credits, 'granted': r.granted, 'note': r.note,
        'status': r.status, 'review_note': r.review_note, 'created_at': r.created_at, 'reviewed_at': r.reviewed_at,
        'balance': balance(r.organization),
    }


def _summary(org, history=30):
    plan = get_subscription(org).plan
    return {
        'balance': balance(org),
        'plan_name': plan.name,
        'plan_monthly': plan.sms_credits,
        'history': [entry_dict(e) for e in SmsCreditEntry.objects.filter(organization=org)[:history]],
    }


def _whole(value, low, high):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if low <= n <= high else None


class MySmsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if request.user.role not in ORG_ROLES:
            return _err('Only event company accounts have SMS credits.', status.HTTP_403_FORBIDDEN)
        reqs = SmsCreditRequest.objects.filter(organization=request.user).select_related('organization')[:5]
        return Response({**_summary(request.user), 'requests': [request_dict(r) for r in reqs], 'packs': PACKS})


class SmsRequestListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not request.user.is_superadmin:
            return _err(IsSuperadmin.message, status.HTTP_403_FORBIDDEN)
        qs = SmsCreditRequest.objects.select_related('organization')
        st = request.query_params.get('status', 'pending')
        if st != 'all':
            qs = qs.filter(status=st)
        return Response([request_dict(r) for r in qs[:200]])

    def post(self, request):
        if request.user.role not in ORG_ROLES:
            return _err('Only event company accounts have SMS credits.', status.HTTP_403_FORBIDDEN)
        credits = _whole(request.data.get('credits'), 1, MAX_REQUEST)
        if credits is None:
            return _err(f'Ask for between 1 and {MAX_REQUEST:,} credits.')
        if SmsCreditRequest.objects.filter(organization=request.user, status=SmsCreditRequest.Status.PENDING).exists():
            return _err('You already have a request waiting. We’ll add the credits once it’s reviewed.')
        r = SmsCreditRequest.objects.create(organization=request.user, credits=credits, note=(request.data.get('note') or '').strip()[:1000])
        return Response(request_dict(r), status=status.HTTP_201_CREATED)


class SmsRequestReviewView(APIView):
    permission_classes = [IsSuperadmin]
    decision = 'approve'

    def post(self, request, pk):
        with transaction.atomic():
            r = get_object_or_404(SmsCreditRequest.objects.select_for_update().select_related('organization'), pk=pk)
            if r.status != SmsCreditRequest.Status.PENDING:
                return _err(f'This request was already {r.status}.')
            note = (request.data.get('note') or '').strip()[:1000]
            if self.decision == 'decline':
                if not note:
                    return _err('Add a reason so they know why.')
                r.status = SmsCreditRequest.Status.DECLINED
            else:
                credits = _whole(request.data.get('credits') or r.credits, 1, MAX_REQUEST)
                if credits is None:
                    return _err(f'Add between 1 and {MAX_REQUEST:,} credits.')
                add_credits(r.organization, credits, SmsCreditEntry.Kind.TOP_UP, note or 'Top-up request approved', request.user)
                r.status, r.granted = SmsCreditRequest.Status.APPROVED, credits
            r.review_note, r.reviewed_by, r.reviewed_at = note, request.user, timezone.now()
            r.save()
        return Response(request_dict(r))


class OrgSmsView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request, org_id):
        return Response(_summary(get_object_or_404(User, pk=org_id, role__in=ORG_ROLES), history=100))

    def post(self, request, org_id):
        org = get_object_or_404(User, pk=org_id, role__in=ORG_ROLES)
        credits = _whole(request.data.get('credits'), -MAX_REQUEST, MAX_REQUEST)
        if not credits:
            return _err('Enter the number of credits to add (or a negative number to take back).')
        if credits < 0 and balance(org) + credits < 0:
            return _err(f'They only have {balance(org):,} credits.')
        kind = SmsCreditEntry.Kind.TOP_UP if credits > 0 else SmsCreditEntry.Kind.ADJUSTMENT
        add_credits(org, credits, kind, (request.data.get('note') or '').strip() or 'Added by Eventlaya', request.user)
        return Response(_summary(org, history=100), status=status.HTTP_201_CREATED)
