"""Organizer API for contests: /api/voting/contests/…  (all under the `voting` module)."""
import csv
import io
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.events.models import Event
from .contest_serializers import (
    ContestSerializer, ContestantSerializer, add_to_first_round, contest_qs, contestants_qs, judge_data, next_number,
    unique_slug,
)
from .access import CONTESTS, JUDGING, RequiresModule, judging_counts, require
from .credits import grant_credits, voter_hash_for
from .models import (
    NEPAL_TZ, Candidate, ContestAuditLog, ContestJudge, ContestRound, Poll, RoundEntry, ScoreSheet, Vote, VoteCredit,
    VotePurchase, audit,
)
from .presets import PRESETS, apply_preset, preset_list
from .rules import FLAG_LABELS, sync_rounds
from .scoring import ContestError, category_results, decide_round, round_standings, sheet_percent, undo_round

User = get_user_model()


def is_organizer(user):
    return bool(user and user.is_authenticated and (getattr(user, 'is_superadmin', False) or user.role == 'organizer'))


class IsOrganizer(permissions.BasePermission):
    message = 'Only event organizers can manage contests.'

    def has_permission(self, request, view):
        return is_organizer(request.user)


def owned_contests(user):
    qs = contest_qs()
    return qs if getattr(user, 'is_superadmin', False) else qs.filter(event__organizer=user)


def get_contest(request, pk):
    poll = get_object_or_404(owned_contests(request.user), pk=pk)
    poll.sync_status()
    sync_rounds(poll)
    return poll


def contest_response(poll, code=status.HTTP_200_OK):
    fresh = contest_qs().get(pk=poll.pk)
    return Response(ContestSerializer(fresh).data, status=code)


def error(e):
    return Response(e.payload(), status=e.code)


class OrganizerView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsOrganizer, RequiresModule(CONTESTS)]


class JudgingView(OrganizerView):
    permission_classes = OrganizerView.permission_classes + [RequiresModule(JUDGING)]


# ---------------------------------------------------------------------------
# Contest CRUD


class ContestListView(OrganizerView):
    def get(self, request):
        qs = owned_contests(request.user)
        if request.query_params.get('event'):
            qs = qs.filter(event_id=request.query_params['event'])
        return Response(ContestSerializer(qs, many=True).data)

    def post(self, request):
        event = get_object_or_404(Event, pk=request.data.get('event'))
        if not (getattr(request.user, 'is_superadmin', False) or event.organizer_id == request.user.id):
            raise PermissionDenied('You can only add contests to your own events.')
        preset = request.data.get('preset') or 'pageant'
        if preset not in PRESETS or preset == 'quick':
            return Response({'error': 'Pick a contest preset (pageant, talent or awards).'}, status=400)
        data = {k: v for k, v in request.data.items() if k not in ('rounds', 'categories', 'profile_fields', 'vote_packs')}
        data.setdefault('title', PRESETS[preset]['name'].split(':')[0])
        ser = ContestSerializer(data={**data, 'votes_per_voter': data.get('votes_per_voter', 1)})
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            poll = ser.save(order=Poll.objects.filter(event=event).count())
            apply_preset(poll, preset)
        return contest_response(poll, status.HTTP_201_CREATED)


class PresetListView(OrganizerView):
    def get(self, request):
        return Response(preset_list())


class ContestDetailView(OrganizerView):
    def get(self, request, pk):
        return contest_response(get_contest(request, pk))

    def patch(self, request, pk):
        poll = get_contest(request, pk)
        ser = ContestSerializer(poll, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return contest_response(poll)

    def delete(self, request, pk):
        poll = get_contest(request, pk)
        poll.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ContestPresetView(OrganizerView):
    def post(self, request, pk):
        poll = get_contest(request, pk)
        key = request.data.get('preset')
        if key not in PRESETS or key == 'quick':
            return Response({'error': 'Unknown preset.'}, status=400)
        if poll.votes.exists() or ScoreSheet.objects.filter(round__poll=poll).exists():
            return Response({'error': 'This contest already has votes or scores, so a preset can’t replace its setup.'}, status=409)
        apply_preset(poll, key)
        audit(poll, request.user, 'preset_applied', f'Preset “{PRESETS[key]["name"]}” applied')
        return contest_response(poll)


class ContestStatusView(OrganizerView):
    """POST open | close the whole contest."""

    def post(self, request, pk, action):
        poll = get_contest(request, pk)
        now = timezone.now()
        if action == 'open':
            if poll.candidates.count() < 1:
                return Response({'error': 'Add contestants before opening voting.'}, status=400)
            poll.status = Poll.Status.OPEN
            if poll.opens_at and poll.opens_at > now:
                poll.opens_at = now
            if poll.closes_at and poll.closes_at <= now:
                poll.closes_at = None
        elif action == 'close':
            poll.status = Poll.Status.CLOSED
            if not poll.closes_at or poll.closes_at > now:
                poll.closes_at = now
        else:
            return Response({'error': 'Unknown action.'}, status=404)
        poll.save()
        audit(poll, request.user, f'contest_{action}', f'Contest {"opened" if action == "open" else "closed"}')
        return contest_response(poll)


# ---------------------------------------------------------------------------
# Contestants


class ContestantListView(OrganizerView):
    def get(self, request, pk):
        poll = get_contest(request, pk)
        return Response(ContestantSerializer(contestants_qs(poll), many=True, context={'poll': poll}).data)

    def post(self, request, pk):
        poll = get_contest(request, pk)
        ser = ContestantSerializer(data=request.data, context={'poll': poll})
        ser.is_valid(raise_exception=True)
        c = ser.save()
        return Response(ContestantSerializer(contestants_qs(poll).get(pk=c.pk), context={'poll': poll}).data, status=201)


class ContestantDetailView(OrganizerView):
    def _get(self, request, pk, cid):
        poll = get_contest(request, pk)
        return poll, get_object_or_404(poll.candidates, pk=cid)

    def patch(self, request, pk, cid):
        poll, c = self._get(request, pk, cid)
        old_status = c.status
        ser = ContestantSerializer(c, data=request.data, partial=True, context={'poll': poll})
        ser.is_valid(raise_exception=True)
        c = ser.save()
        if c.status != old_status:
            audit(poll, request.user, 'contestant_status', f'{poll.format_number(c.number)} {c.name}: {old_status} → {c.status}',
                  contestant=str(c.id))
        return Response(ContestantSerializer(contestants_qs(poll).get(pk=c.pk), context={'poll': poll}).data)

    def delete(self, request, pk, cid):
        poll, c = self._get(request, pk, cid)
        if c.votes.exists() or c.score_sheets.exists():
            return Response({'error': f'{c.name} already has votes or scores. Mark them as withdrawn instead of deleting.'}, status=409)
        c.delete()
        return Response(status=204)


class ContestantBulkView(OrganizerView):
    """POST {contestants: [{name, ...}]} — add many at once (numbers auto-assigned unless given)."""

    def post(self, request, pk):
        poll = get_contest(request, pk)
        rows = request.data.get('contestants')
        if not isinstance(rows, list) or not rows:
            return Response({'error': 'Send a list of contestants.'}, status=400)
        if len(rows) > 500:
            return Response({'error': 'Add up to 500 contestants at a time.'}, status=400)
        return self._create(request, poll, rows)

    @staticmethod
    def _create(request, poll, rows):
        errors, created = {}, []
        with transaction.atomic():
            for i, row in enumerate(rows):
                ser = ContestantSerializer(data=row, context={'poll': poll})
                if ser.is_valid():
                    created.append(ser.save())
                else:
                    errors[i + 1] = ser.errors
            if errors:
                transaction.set_rollback(True)
                return Response({'error': f'{len(errors)} {"row has" if len(errors) == 1 else "rows have"} problems. Nothing was added.',
                                 'rows': errors}, status=400)
        audit(poll, request.user, 'contestants_added', f'{len(created)} contestants added')
        return Response(ContestantSerializer(contestants_qs(poll).filter(pk__in=[c.pk for c in created]), many=True,
                                             context={'poll': poll}).data, status=201)


class ContestantImportView(OrganizerView):
    """POST {csv: "name,number,subtitle,bio,photo_url,<profile field keys or labels>…"} — header row required."""

    def post(self, request, pk):
        poll = get_contest(request, pk)
        text = request.data.get('csv') or ''
        if not text and request.FILES.get('file'):
            text = request.FILES['file'].read().decode('utf-8-sig', errors='replace')
        text = text.lstrip('﻿')
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            return Response({'error': 'The CSV needs a header row, e.g. name,number,subtitle,bio.'}, status=400)
        fields = {f.key: f for f in poll.profile_fields.all()}
        by_label = {f.label.strip().lower(): f.key for f in fields.values()}
        aliases = {'name': 'name', 'full name': 'name', 'number': 'number', 'no': 'number', '#': 'number',
                   'subtitle': 'subtitle', 'tagline': 'subtitle', 'bio': 'description', 'description': 'description',
                   'photo': 'photo_url', 'photo_url': 'photo_url'}
        rows = []
        for raw in reader:
            row, profile = {}, {}
            for k, v in raw.items():
                if k is None:
                    continue
                key = k.strip().lower()
                v = (v or '').strip()
                if key in aliases:
                    target = aliases[key]
                    if target == 'number':
                        digits = ''.join(ch for ch in v if ch.isdigit())
                        if digits:
                            row['number'] = int(digits)
                    elif v:
                        row[target] = v
                elif key in fields or key in by_label:
                    profile[fields[key].key if key in fields else by_label[key]] = v
            if not any(row.values()) and not profile:
                continue
            if profile:
                row['profile'] = profile
            rows.append(row)
        if not rows:
            return Response({'error': 'No contestants found in the CSV.'}, status=400)
        if len(rows) > 500:
            return Response({'error': 'Import up to 500 contestants at a time.'}, status=400)
        return ContestantBulkView._create(request, poll, rows)


class ContestantReorderView(OrganizerView):
    """POST {ids: [...]} in display order; {renumber: true} also sets numbers 1..n in that order."""

    def post(self, request, pk):
        poll = get_contest(request, pk)
        ids = [str(i) for i in request.data.get('ids') or []]
        own = {str(i) for i in poll.candidates.values_list('id', flat=True)}
        if not ids or set(ids) != own:
            return Response({'error': 'Send every contestant id exactly once.'}, status=400)
        renumber = request.data.get('renumber') is True
        with transaction.atomic():
            if renumber:
                poll.candidates.update(number=None)
            for i, cid in enumerate(ids):
                fields = {'order': i}
                if renumber:
                    fields['number'] = i + 1
                Candidate.objects.filter(pk=cid).update(**fields)
        if renumber:
            audit(poll, request.user, 'contestants_renumbered', 'Contestant numbers reassigned in display order')
        return Response(ContestantSerializer(contestants_qs(poll), many=True, context={'poll': poll}).data)


# ---------------------------------------------------------------------------
# Rounds


class RoundActionView(OrganizerView):
    """POST open | close | decide | undo | entries for one round."""

    def post(self, request, pk, rid, action):
        poll = get_contest(request, pk)
        rnd = get_object_or_404(poll.rounds, pk=rid)
        now = timezone.now()
        try:
            if action == 'open':
                if rnd.finalized_at:
                    return Response({'error': f'{rnd.name} has been decided. Undo the decision to reopen it.'}, status=409)
                if not rnd.entries.exists():
                    return Response({'error': f'Nobody is in {rnd.name} yet.'}, status=400)
                rnd.status = ContestRound.Status.OPEN
                if rnd.opens_at and rnd.opens_at > now:
                    rnd.opens_at = now
                if rnd.closes_at and rnd.closes_at <= now:
                    rnd.closes_at = None
                rnd.save()
                audit(poll, request.user, 'round_open', f'{rnd.name} opened', round=str(rnd.id))
            elif action == 'close':
                rnd.status = ContestRound.Status.CLOSED
                if not rnd.closes_at or rnd.closes_at > now:
                    rnd.closes_at = now
                rnd.save()
                audit(poll, request.user, 'round_close', f'{rnd.name} closed', round=str(rnd.id))
            elif action == 'decide':
                if request.data.get('confirm') is not True:
                    return Response({'error': 'Send {"confirm": true} to advance and eliminate contestants.'}, status=400)
                ids = request.data.get('contestant_ids')
                return Response(decide_round(rnd, request.user, ids if isinstance(ids, list) else None))
            elif action == 'undo':
                return Response(undo_round(rnd, request.user))
            elif action == 'entries':
                # Set who is in the round (useful for the first round, or to fix a mistake before it's decided)
                if rnd.finalized_at:
                    return Response({'error': f'{rnd.name} has been decided.'}, status=409)
                ids = {str(i) for i in request.data.get('contestant_ids') or []}
                own = {str(i) for i in poll.candidates.values_list('id', flat=True)}
                if not ids <= own:
                    return Response({'error': 'One of the contestants belongs to another contest.'}, status=400)
                with transaction.atomic():
                    removed = rnd.entries.exclude(contestant_id__in=ids)
                    if Vote.objects.filter(round=rnd, candidate_id__in=removed.values('contestant_id'), is_void=False).exists():
                        return Response({'error': 'A contestant with votes in this round can’t be taken out. Withdraw them instead.'}, status=409)
                    removed.delete()
                    for cid in ids:
                        RoundEntry.objects.get_or_create(round=rnd, contestant_id=cid)
                audit(poll, request.user, 'round_entries', f'{rnd.name}: {len(ids)} contestants', round=str(rnd.id))
            else:
                return Response({'error': 'Unknown action.'}, status=404)
        except ContestError as e:
            return error(e)
        return contest_response(poll)


# ---------------------------------------------------------------------------
# Results, dashboard


class ContestResultsView(OrganizerView):
    """GET ?round=<id> | ?category=<id>; no parameter → every round + category."""

    def get(self, request, pk):
        poll = get_contest(request, pk)
        rid, cid = request.query_params.get('round'), request.query_params.get('category')
        if rid:
            return Response(round_standings(poll, get_object_or_404(poll.rounds, pk=rid)))
        if cid:
            return Response(category_results(poll, get_object_or_404(poll.categories, pk=cid)))
        rounds = list(poll.rounds.all())
        return Response({
            'overall': round_standings(poll, None) if not rounds else None,
            'rounds': [round_standings(poll, r) for r in rounds],
            'categories': [category_results(poll, c) for c in poll.categories.all()],
            'placement_titles': poll.placement_titles,
        })


class ContestDashboardView(OrganizerView):
    def get(self, request, pk):
        poll = get_contest(request, pk)
        votes = Vote.objects.filter(poll=poll)
        counted = votes.filter(is_void=False)
        now = timezone.now()
        hourly_start = (now.astimezone(NEPAL_TZ) - timedelta(hours=47)).replace(minute=0, second=0, microsecond=0)
        buckets = [0] * 48
        for t, n in counted.filter(voted_at__gte=hourly_start).values_list('voted_at', 'quantity').iterator():
            i = int((t - hourly_start).total_seconds() // 3600)
            if 0 <= i < 48:
                buckets[i] += n
        hours = [{'t': hourly_start + timedelta(hours=i), 'count': n} for i, n in enumerate(buckets)]
        daily = [{'date': r['nepal_date'], 'count': r['n']} for r in
                 counted.values('nepal_date').annotate(n=Sum('quantity')).order_by('nepal_date')]
        names = {c.id: c for c in poll.candidates.all()}
        per_contestant = sorted([
            {'contestant_id': str(r['candidate']), 'name': names[r['candidate']].name,
             'display_number': poll.format_number(names[r['candidate']].number), 'votes': r['n']}
            for r in counted.filter(category__isnull=True).values('candidate').annotate(n=Sum('quantity')) if r['candidate'] in names
        ], key=lambda x: -x['votes'])
        rounds = {str(r.id): r.name for r in poll.rounds.all()}
        per_round = [{'round_id': str(r['round']) if r['round'] else None, 'name': rounds.get(str(r['round']), 'No round'), 'votes': r['n']}
                     for r in counted.filter(category__isnull=True).values('round').annotate(n=Sum('quantity'))]
        cats = {str(c.id): c.name for c in poll.categories.all()}
        per_category = [{'category_id': str(r['category']), 'name': cats.get(str(r['category']), '?'), 'votes': r['n']}
                        for r in counted.filter(category__isnull=False).values('category').annotate(n=Sum('quantity'))]
        by_source = {r['source']: r['n'] for r in counted.values('source').annotate(n=Sum('quantity'))}
        return Response({
            'totals': {
                'votes': sum(by_source.values()), 'voters': counted.values('voter_identifier').distinct().count(),
                'today': counted.filter(nepal_date=now.astimezone(NEPAL_TZ).date()).aggregate(n=Sum('quantity'))['n'] or 0,
                'flagged': votes.exclude(flags=[]).filter(is_void=False).count(), 'void': votes.filter(is_void=True).count(),
                'by_source': by_source,
            },
            'hourly': hours, 'daily': daily, 'per_contestant': per_contestant, 'per_round': per_round,
            'per_category': per_category,
            'judges': [judge_data(j) for j in poll.judges.select_related('user')] if judging_counts(poll) else [],
            'paid': paid_summary(poll, names),
        })


def paid_summary(poll, names=None):
    """Vote-pack money and paid votes. Revenue per contestant = purchases made on that contestant's page
    (votes bought elsewhere and spent later can't be tied to a price, so they show as paid votes only)."""
    from apps.payments.services import money
    names = names or {c.id: c for c in poll.candidates.all()}
    purchases = VotePurchase.objects.filter(poll=poll)
    paid = purchases.filter(status=VotePurchase.Status.PAID)
    agg = paid.aggregate(n=Count('id'), amount=Sum('amount'), votes=Sum('votes'), bonus=Sum('bonus_votes'))
    refunded = purchases.filter(status=VotePurchase.Status.REFUNDED).aggregate(n=Count('id'), amount=Sum('amount'))
    paid_votes = {r['candidate']: r['n'] for r in Vote.objects.filter(poll=poll, is_void=False).exclude(source=Vote.Source.FREE)
                  .values('candidate').annotate(n=Sum('quantity'))}
    revenue = {r['contestant']: (r['amount'], r['n']) for r in paid.exclude(contestant__isnull=True).values('contestant')
               .annotate(amount=Sum('amount'), n=Count('id'))}
    per_contestant = []
    for cid in set(paid_votes) | set(revenue):
        c = names.get(cid)
        if c is None:
            continue
        amount, n = revenue.get(cid, (0, 0))
        per_contestant.append({'contestant_id': str(cid), 'name': c.name, 'display_number': poll.format_number(c.number),
                               'paid_votes': paid_votes.get(cid, 0), 'revenue': str(money(amount or 0)), 'purchases': n})
    per_contestant.sort(key=lambda r: (-float(r['revenue']), -r['paid_votes']))
    per_pack = [{'pack_id': str(r['pack']) if r['pack'] else None, 'label': r['label'], 'sold': r['n'], 'revenue': str(money(r['amount'] or 0))}
                for r in paid.values('pack', 'label').annotate(n=Count('id'), amount=Sum('amount')).order_by('-amount')]
    return {
        'enabled': poll.paid_votes_enabled,
        'revenue': str(money(agg['amount'] or 0)), 'purchases': agg['n'],
        'votes_sold': (agg['votes'] or 0) + (agg['bonus'] or 0),
        'pending': purchases.filter(status=VotePurchase.Status.PENDING).count(),
        'refunded': str(money(refunded['amount'] or 0)), 'refunded_count': refunded['n'],
        'unspent_credits': VoteCredit.objects.filter(poll=poll).aggregate(n=Sum('amount'))['n'] or 0,
        'flagged_purchases': purchases.exclude(flags=[]).count(),
        'per_contestant': per_contestant, 'per_pack': per_pack,
    }


def purchase_row(p, poll):
    i = p.intent
    return {
        'id': str(p.id), 'created_at': p.created_at, 'paid_at': p.paid_at, 'refunded_at': p.refunded_at, 'status': p.status,
        'label': p.label, 'votes': p.votes, 'bonus_votes': p.bonus_votes, 'amount': str(p.amount),
        'voter_ref': p.voter_identifier[:12], 'method': p.method,
        'contestant': {'id': str(p.contestant_id), 'name': p.contestant.name, 'display_number': poll.format_number(p.contestant.number)} if p.contestant_id else None,
        'auto_vote': p.auto_vote, 'auto_voted': p.auto_voted, 'auto_vote_note': p.auto_vote_note,
        'payment_id': str(i.id) if i else None, 'provider': i.provider if i else None,
        'provider_txn_id': i.provider_txn_id if i else '', 'payment_status': i.status if i else None,
        'ip_ref': p.ip_hash[:10], 'device_ref': p.device_hash[:10], 'flags': p.flags,
    }


class PurchaseListView(OrganizerView):
    """GET ?status= — vote-pack purchases (latest 500). Refunds are recorded on the payment (Payments page or
    POST /api/payments/intents/<payment_id>/refund/), which removes the unspent votes here."""

    def get(self, request, pk):
        poll = get_contest(request, pk)
        qs = VotePurchase.objects.filter(poll=poll).select_related('intent', 'contestant')
        if request.query_params.get('status'):
            qs = qs.filter(status__in=request.query_params['status'].split(','))
        else:
            qs = qs.exclude(status=VotePurchase.Status.FAILED)
        return Response({'summary': paid_summary(poll), 'purchases': [purchase_row(p, poll) for p in qs[:500]]})


# ---------------------------------------------------------------------------
# Judges


class JudgeListView(JudgingView):
    def get(self, request, pk):
        poll = get_contest(request, pk)
        return Response([judge_data(j) for j in poll.judges.select_related('user')])

    def post(self, request, pk):
        from apps.accounts.team import temporary_password, unique_username
        poll = get_contest(request, pk)
        email = (request.data.get('email') or '').strip().lower()
        name = (request.data.get('name') or '').strip()[:120]
        if not email or '@' not in email:
            return Response({'error': 'Enter the judge’s email address.'}, status=400)
        user = User.objects.filter(email__iexact=email).first()
        temp = None
        created = False
        if user is None:
            temp = temporary_password()
            first, _, last = name.partition(' ')
            user = User.objects.create_user(username=unique_username(email), email=email, password=temp,
                                            role=User.Role.ATTENDEE, first_name=first[:150], last_name=last[:150])
            created = True
        elif not user.is_active:
            return Response({'error': f'{email} is a deactivated account.'}, status=400)
        if poll.judges.filter(user=user).exists():
            return Response({'error': f'{email} is already a judge of this contest.'}, status=400)
        judge = ContestJudge.objects.create(poll=poll, user=user, name=name)
        audit(poll, request.user, 'judge_added', f'Judge {judge.display_name} added', judge=str(judge.id))
        self._invite(poll, judge, created)
        data = judge_data(judge)
        data.update({'temporary_password': temp, 'created': created,
                     'message': f'{email} can now score {poll.title}.'})
        return Response(data, status=201)

    @staticmethod
    def _invite(poll, judge, created):
        link = f"{getattr(settings, 'FRONTEND_URL', 'https://eventlaya.com').rstrip('/')}/judge/{judge.id}"
        how = ('An Eventlaya account was created for you. The organizer will give you a temporary password; '
               'change it after signing in.') if created else 'Sign in with your existing Eventlaya account.'
        try:
            send_mail(
                subject=f'You’re a judge for {poll.title}',
                message=(f'Namaste {judge.display_name},\n\n{poll.event.organizer.organization_name or "The organizer"} invited you to '
                         f'judge “{poll.title}” ({poll.event.title}).\n\n{how}\n\nOpen your scoring sheet: {link}\n\nEventlaya'),
                from_email=settings.DEFAULT_FROM_EMAIL, recipient_list=[judge.user.email],
            )
        except Exception:
            pass


class JudgeDetailView(JudgingView):
    def patch(self, request, pk, jid):
        poll = get_contest(request, pk)
        judge = get_object_or_404(poll.judges, pk=jid)
        if 'name' in request.data:
            judge.name = (request.data.get('name') or '').strip()[:120]
        if 'is_active' in request.data:
            judge.is_active = bool(request.data.get('is_active'))
        judge.save()
        if 'excluded_contestants' in request.data:
            ids = [str(i) for i in request.data.get('excluded_contestants') or []]
            judge.excluded_contestants.set(poll.candidates.filter(id__in=ids))
            audit(poll, request.user, 'judge_conflicts', f'{judge.display_name}: {len(ids)} conflict(s) of interest', judge=str(judge.id))
        temp = None
        if request.data.get('reset_password'):
            if judge.user.role != User.Role.ATTENDEE or judge.user.is_superadmin:
                return Response({'error': 'Only judge accounts created here can have their password reset here.'}, status=400)
            from apps.accounts.team import temporary_password
            temp = temporary_password()
            judge.user.set_password(temp)
            judge.user.save(update_fields=['password'])
        data = judge_data(judge)
        data['temporary_password'] = temp
        return Response(data)

    def delete(self, request, pk, jid):
        poll = get_contest(request, pk)
        judge = get_object_or_404(poll.judges, pk=jid)
        if judge.sheets.filter(status=ScoreSheet.Status.SUBMITTED).exists():
            judge.is_active = False
            judge.save(update_fields=['is_active'])
            audit(poll, request.user, 'judge_deactivated', f'Judge {judge.display_name} removed (scores kept, not counted)')
            return Response({'message': 'The judge has submitted scores, so they were deactivated (their scores no longer count).'})
        audit(poll, request.user, 'judge_removed', f'Judge {judge.display_name} removed')
        judge.delete()
        return Response(status=204)


class SheetListView(JudgingView):
    """GET ?round=<id> — every sheet (organizer sees all scores)."""

    def get(self, request, pk):
        poll = get_contest(request, pk)
        qs = ScoreSheet.objects.filter(round__poll=poll).select_related('judge__user', 'contestant', 'round')
        if request.query_params.get('round'):
            qs = qs.filter(round_id=request.query_params['round'])
        out = []
        for s in qs.order_by('round__order', 'contestant__number', 'judge__invited_at'):
            out.append({'id': str(s.id), 'round_id': str(s.round_id), 'judge_id': str(s.judge_id), 'judge': s.judge.display_name,
                        'contestant_id': str(s.contestant_id), 'contestant': s.contestant.name,
                        'display_number': poll.format_number(s.contestant.number), 'scores': s.scores, 'comment': s.comment,
                        'status': s.status, 'submitted_at': s.submitted_at,
                        'percent': round(sheet_percent(s.scores or {}, list(s.round.criteria.all())), 2)})
        return Response(out)


class SheetUnlockView(JudgingView):
    def post(self, request, pk, sid):
        poll = get_contest(request, pk)
        sheet = get_object_or_404(ScoreSheet.objects.filter(round__poll=poll).select_related('judge__user', 'contestant', 'round'), pk=sid)
        if sheet.round.finalized_at:
            return Response({'error': f'{sheet.round.name} has been decided. Undo the decision first.'}, status=409)
        sheet.status = ScoreSheet.Status.DRAFT
        sheet.unlocked_at = timezone.now()
        sheet.save(update_fields=['status', 'unlocked_at', 'updated_at'])
        audit(poll, request.user, 'sheet_unlocked',
              f'Unlocked {sheet.judge.display_name}’s sheet for {sheet.contestant.name} ({sheet.round.name})', sheet=str(sheet.id))
        return Response({'message': 'Sheet unlocked. The judge can edit and resubmit it.'})


# ---------------------------------------------------------------------------
# Anti-fraud


def vote_row(v, poll):
    return {
        'id': str(v.id), 'voted_at': v.voted_at, 'contestant_id': str(v.candidate_id), 'contestant': v.candidate.name,
        'display_number': poll.format_number(v.candidate.number), 'category': v.category.name if v.category_id else None,
        'round': v.round.name if v.round_id else None, 'quantity': v.quantity, 'source': v.source, 'method': v.method,
        'voter_ref': v.voter_identifier[:12], 'ip_ref': v.ip_hash[:10], 'device_ref': v.device_hash[:10],
        'flags': v.flags, 'is_void': v.is_void, 'void_reason': v.void_reason, 'voided_at': v.voided_at,
        'payment_ref': v.payment_ref,
    }


class FlagListView(OrganizerView):
    """GET flagged votes + groups by IP and device. ?all=1 lists every vote (latest 500)."""

    def get(self, request, pk):
        poll = get_contest(request, pk)
        qs = Vote.objects.filter(poll=poll).select_related('candidate', 'category', 'round').order_by('-voted_at')
        if request.query_params.get('void') == '1':
            qs = qs.filter(is_void=True)
        elif request.query_params.get('all') != '1':
            qs = qs.exclude(flags=[])
        flagged = Vote.objects.filter(poll=poll).exclude(flags=[]).filter(is_void=False)
        groups = []
        for field, label in (('ip_hash', 'IP address'), ('device_hash', 'Device')):
            for r in flagged.exclude(**{field: ''}).values(field).annotate(n=Sum('quantity'), c=Count('id'),
                                                                           voters=Count('voter_identifier', distinct=True)).order_by('-n')[:20]:
                groups.append({'kind': field.split('_')[0], 'label': label, 'ref': r[field][:10], 'hash': r[field],
                               'votes': r['n'], 'rows': r['c'], 'voters': r['voters']})
        counts = {}
        for flags in flagged.values_list('flags', flat=True):
            for f in flags:
                counts[f] = counts.get(f, 0) + 1
        return Response({
            'labels': FLAG_LABELS,
            'counts': counts,
            'groups': groups,
            'votes': [vote_row(v, poll) for v in qs[:500]],
        })


class VoidVotesView(OrganizerView):
    """POST {vote_ids? | ip_hash? | device_hash? | flag?, reason, undo?: bool}."""

    def post(self, request, pk):
        poll = get_contest(request, pk)
        undo = request.data.get('undo') is True
        reason = (request.data.get('reason') or '').strip()[:255]
        if not undo and not reason:
            return Response({'error': 'Give a reason for voiding these votes (it goes in the audit log).'}, status=400)
        qs = Vote.objects.filter(poll=poll, is_void=undo)
        if request.data.get('vote_ids'):
            qs = qs.filter(id__in=[str(i) for i in request.data['vote_ids']])
        elif request.data.get('ip_hash'):
            qs = qs.filter(ip_hash=request.data['ip_hash'])
        elif request.data.get('device_hash'):
            qs = qs.filter(device_hash=request.data['device_hash'])
        elif request.data.get('flag'):
            qs = qs.filter(flags__contains=[request.data['flag']]) if _json_contains_supported() else \
                qs.filter(id__in=[v.id for v in qs if request.data['flag'] in (v.flags or [])])
        else:
            return Response({'error': 'Say which votes: vote_ids, ip_hash, device_hash or flag.'}, status=400)
        ids = list(qs.values_list('id', flat=True))
        total = qs.aggregate(n=Sum('quantity'))['n'] or 0
        if undo:
            Vote.objects.filter(id__in=ids).update(is_void=False, void_reason='', voided_at=None, voided_by=None)
            audit(poll, request.user, 'votes_restored', f'{total} votes restored ({len(ids)} rows)', votes=[str(i) for i in ids][:200])
            return Response({'message': f'{total} votes restored.', 'rows': len(ids), 'votes': total})
        paid = qs.exclude(source=Vote.Source.FREE).aggregate(n=Sum('quantity'))['n'] or 0
        refs = sorted({r for v in qs.exclude(source=Vote.Source.FREE).values_list('payment_ref', flat=True) for r in v.split(',') if r and r not in ('bonus', 'paid')})
        Vote.objects.filter(id__in=ids).update(is_void=True, void_reason=reason, voided_at=timezone.now(), voided_by=request.user)
        audit(poll, request.user, 'votes_voided', f'{total} votes voided ({len(ids)} rows): {reason}', reason=reason,
              votes=[str(i) for i in ids][:200], paid_votes=paid, payments=refs[:50])
        data = {'message': f'{total} votes voided. They no longer count.', 'rows': len(ids), 'votes': total, 'paid_votes': paid}
        if paid:
            # Voiding doesn't give money back: tell the organizer which payments to consider refunding
            data['warning'] = (f'{paid} of these were paid votes. Voiding doesn’t refund the buyer: if the purchase was genuine, '
                               'refund it from the merchant dashboard and mark it refunded on the Payments page.')
            data['payments'] = refs
        return Response(data)


def _json_contains_supported():
    from django.db import connection
    return connection.vendor == 'postgresql'


class AuditLogView(OrganizerView):
    def get(self, request, pk):
        poll = get_contest(request, pk)
        return Response([{'id': str(a.id), 'action': a.action, 'summary': a.summary, 'detail': a.detail,
                          'actor': (a.actor.get_full_name() or a.actor.email) if a.actor else None, 'created_at': a.created_at}
                         for a in ContestAuditLog.objects.filter(poll=poll).select_related('actor')[:300]])


class GrantCreditsView(OrganizerView):
    """POST {phone | email, votes, note} — organizer gives bonus votes (e.g. a sponsor promotion)."""

    def post(self, request, pk):
        poll = get_contest(request, pk)
        try:
            votes = int(request.data.get('votes') or 0)
        except (TypeError, ValueError):
            votes = 0
        if votes < 1 or votes > 10000:
            return Response({'error': 'Give between 1 and 10,000 votes.'}, status=400)
        try:
            voter = voter_hash_for(poll, phone=request.data.get('phone'), email=request.data.get('email'))
        except ValueError as e:
            return Response({'error': str(e)}, status=400)
        row = grant_credits(poll, voter, votes, VoteCredit.Source.BONUS, note=(request.data.get('note') or 'Bonus votes'), actor=request.user)
        audit(poll, request.user, 'credits_granted', f'{votes} bonus votes granted', credit=str(row.id))
        return Response({'message': f'{votes} bonus votes added.'}, status=201)


# ---------------------------------------------------------------------------
# Exports (CSV with a BOM, so Excel opens Nepali text correctly)


def csv_response(name):
    response = HttpResponse(content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="{name}.csv"'
    response.write('﻿')
    return response


class ContestExportView(OrganizerView):
    def get(self, request, pk):
        poll = get_contest(request, pk)
        kind = request.query_params.get('kind', 'votes')
        base = slugify(poll.title) or 'contest'
        if kind == 'votes':
            response = csv_response(f'{base}-votes')
            w = csv.writer(response)
            w.writerow(['Voted at (Nepal time)', 'Voter reference (hashed)', 'Contestant number', 'Contestant', 'Category',
                        'Round', 'Votes', 'Source', 'Payment ref', 'Verification', 'IP reference (hashed)',
                        'Device reference (hashed)', 'Flags', 'Void', 'Void reason'])
            for v in Vote.objects.filter(poll=poll).select_related('candidate', 'category', 'round').order_by('voted_at').iterator():
                w.writerow([v.voted_at.astimezone(NEPAL_TZ).strftime('%Y-%m-%d %H:%M:%S'), v.voter_identifier[:16],
                            poll.format_number(v.candidate.number), v.candidate.name, v.category.name if v.category_id else '',
                            v.round.name if v.round_id else '', v.quantity, v.source, v.payment_ref, v.method, v.ip_hash[:12], v.device_hash[:12],
                            ' '.join(v.flags or []), 'yes' if v.is_void else '', v.void_reason])
            return response
        if kind == 'scores':
            require(JUDGING, request, poll)
            response = csv_response(f'{base}-judges-scores')
            w = csv.writer(response)
            for rnd in poll.rounds.filter(judging_enabled=True):
                criteria = list(rnd.criteria.all())
                w.writerow([rnd.name])
                w.writerow(['Judge', 'Contestant number', 'Contestant', *[f'{c.name} (/{c.max_points:g})' for c in criteria],
                            'Total %', 'Status', 'Submitted at', 'Comment'])
                for s in rnd.score_sheets.select_related('judge__user', 'contestant').order_by('contestant__number', 'judge__invited_at'):
                    w.writerow([s.judge.display_name, poll.format_number(s.contestant.number), s.contestant.name,
                                *[(s.scores or {}).get(str(c.id), '') for c in criteria],
                                round(sheet_percent(s.scores or {}, criteria), 2), s.status,
                                s.submitted_at.astimezone(NEPAL_TZ).strftime('%Y-%m-%d %H:%M') if s.submitted_at else '', s.comment])
                w.writerow([])
            return response
        if kind == 'results':
            response = csv_response(f'{base}-results')
            w = csv.writer(response)
            rounds = list(poll.rounds.all()) or [None]
            for rnd in rounds:
                st = round_standings(poll, rnd, detail=False)
                w.writerow([rnd.name if rnd else 'Results', f'Judges {st["weights"]["judges"]}% / Public {st["weights"]["public"]}%'])
                w.writerow(['Rank', 'Number', 'Contestant', 'Public votes', 'Public score', 'Judges score',
                            *[c['name'] for c in st['criteria']], 'Final score', 'Status'])
                for r in st['rows']:
                    w.writerow([r['rank'], r['display_number'], r['name'], r['votes'], r['public_score'],
                                '' if r['judge_score'] is None else r['judge_score'],
                                *[r['criteria'].get(c['id']) if r['criteria'].get(c['id']) is not None else '' for c in st['criteria']],
                                r['final'], r['entry_status'] or r['status']])
                w.writerow([])
            for cat in poll.categories.all():
                res = category_results(poll, cat)
                w.writerow([cat.name, cat.get_selection_display()])
                w.writerow(['Rank', 'Number', 'Contestant', 'Votes', 'Score'])
                for r in res['rows']:
                    w.writerow([r['rank'] or '', r['display_number'], r['name'], r['votes'], r['score']])
                w.writerow([])
            return response
        if kind == 'purchases':
            response = csv_response(f'{base}-vote-purchases')
            w = csv.writer(response)
            w.writerow(['Created (Nepal time)', 'Paid at', 'Status', 'Pack', 'Votes', 'Bonus votes', 'Amount (NPR)', 'Voter reference (hashed)',
                        'Bought for', 'Votes cast automatically', 'Provider', 'Payment id', 'Provider transaction id', 'Flags'])
            for p in VotePurchase.objects.filter(poll=poll).exclude(status=VotePurchase.Status.FAILED).select_related('intent', 'contestant'):
                r = purchase_row(p, poll)
                w.writerow([p.created_at.astimezone(NEPAL_TZ).strftime('%Y-%m-%d %H:%M'),
                            p.paid_at.astimezone(NEPAL_TZ).strftime('%Y-%m-%d %H:%M') if p.paid_at else '', p.status, p.label, p.votes,
                            p.bonus_votes, p.amount, p.voter_identifier[:16],
                            f"{r['contestant']['display_number']} {r['contestant']['name']}" if r['contestant'] else '', p.auto_voted,
                            r['provider'] or '', r['payment_id'] or '', r['provider_txn_id'], ' '.join(p.flags or [])])
            return response
        return Response({'error': 'kind must be votes, scores, results or purchases.'}, status=400)
