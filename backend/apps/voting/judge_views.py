"""Judge API: /api/voting/judge/…  A judge is any signed-in account with a ContestJudge row for the contest."""
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .access import JUDGING, ModuleDisabled, RequiresModule, on_for_contest
from .contest_serializers import judge_progress
from .models import Candidate, ContestJudge, ContestRound, ScoreSheet
from .scoring import sheet_percent


def my_judge(request, jid):
    judge = get_object_or_404(ContestJudge.objects.select_related('poll__event', 'user'), pk=jid, user=request.user, is_active=True)
    if not on_for_contest(JUDGING, judge.poll, request.user):
        raise ModuleDisabled(JUDGING)
    return judge


def judging_rounds(poll):
    return [r for r in poll.rounds.filter(judging_enabled=True).prefetch_related('criteria')]


def can_score(rnd):
    return rnd.judging_enabled and not rnd.finalized_at and rnd.computed_status() != ContestRound.Status.UPCOMING


def round_info(rnd):
    st = rnd.computed_status()
    return {'id': str(rnd.id), 'name': rnd.name, 'status': st, 'finalized': bool(rnd.finalized_at), 'can_score': can_score(rnd),
            'criteria': [{'id': str(c.id), 'name': c.name, 'description': c.description, 'max_points': float(c.max_points),
                          'weight': float(c.weight)} for c in rnd.criteria.all()]}


class MyJudgingView(APIView):
    permission_classes = [permissions.IsAuthenticated, RequiresModule(JUDGING)]

    def get(self, request):
        out = []
        for j in ContestJudge.objects.filter(user=request.user, is_active=True).select_related('poll__event__organizer'):
            if not on_for_contest(JUDGING, j.poll, request.user):
                continue
            rounds = judging_rounds(j.poll)
            out.append({'id': str(j.id), 'contest_id': str(j.poll_id), 'contest': j.poll.title, 'event': j.poll.event.title,
                        'cover_url': j.poll.cover_url, 'progress': judge_progress(j),
                        'scoring_open': any(can_score(r) for r in rounds)})
        return Response(out)


class JudgeSheetView(APIView):
    """GET ?round=<id> → criteria + contestants + my sheets (+ others' if the organizer allows)."""

    permission_classes = [permissions.IsAuthenticated, RequiresModule(JUDGING)]

    def get(self, request, jid):
        judge = my_judge(request, jid)
        poll = judge.poll
        rounds = judging_rounds(poll)
        if not rounds:
            return Response({'judge': {'id': str(judge.id), 'name': judge.display_name},
                             'contest': {'id': str(poll.id), 'title': poll.title, 'event': poll.event.title},
                             'rounds': [], 'round': None, 'contestants': []})
        rid = request.query_params.get('round')
        rnd = next((r for r in rounds if str(r.id) == rid), None) if rid else None
        if rnd is None:
            open_ = [r for r in rounds if can_score(r)]
            rnd = open_[0] if open_ else rounds[-1]
        criteria = list(rnd.criteria.all())
        excluded = set(judge.excluded_contestants.values_list('id', flat=True))
        entries = (rnd.entries.select_related('contestant').exclude(contestant__status=Candidate.Status.WITHDRAWN)
                   .order_by('contestant__number', 'contestant__order'))
        mine = {s.contestant_id: s for s in ScoreSheet.objects.filter(round=rnd, judge=judge)}
        others = {}
        if poll.judges_see_others:
            for s in ScoreSheet.objects.filter(round=rnd, status=ScoreSheet.Status.SUBMITTED, judge__is_active=True).exclude(judge=judge).select_related('judge__user'):
                others.setdefault(s.contestant_id, []).append({'judge': s.judge.display_name, 'scores': s.scores,
                                                               'percent': round(sheet_percent(s.scores or {}, criteria), 2)})
        contestants = []
        for e in entries:
            c = e.contestant
            if c.id in excluded:
                continue
            s = mine.get(c.id)
            contestants.append({
                'id': str(c.id), 'name': c.name, 'number': c.number, 'display_number': poll.format_number(c.number),
                'photo_url': c.photo_url, 'subtitle': c.subtitle,
                'sheet': {'id': str(s.id), 'scores': s.scores, 'comment': s.comment, 'status': s.status,
                          'submitted_at': s.submitted_at, 'percent': round(sheet_percent(s.scores or {}, criteria), 2)} if s else None,
                'others': others.get(c.id) if poll.judges_see_others else None,
            })
        return Response({
            'judge': {'id': str(judge.id), 'name': judge.display_name},
            'contest': {'id': str(poll.id), 'title': poll.title, 'event': poll.event.title, 'judges_see_others': poll.judges_see_others,
                        'excluded_count': len(excluded)},
            'rounds': [round_info(r) for r in rounds],
            'round': round_info(rnd),
            'contestants': contestants,
        })

    def put(self, request, jid):
        """Save (or submit) one sheet: {round, contestant, scores: {criterion_id: points}, comment, submit}."""
        judge = my_judge(request, jid)
        poll = judge.poll
        rnd = get_object_or_404(poll.rounds.filter(judging_enabled=True), pk=request.data.get('round'))
        if not can_score(rnd):
            msg = f'{rnd.name} has been decided, so scores are final.' if rnd.finalized_at else f'{rnd.name} hasn’t started yet.'
            return Response({'error': msg}, status=status.HTTP_409_CONFLICT)
        contestant = get_object_or_404(rnd.entries.exclude(contestant__status=Candidate.Status.WITHDRAWN), contestant_id=request.data.get('contestant')).contestant
        if judge.excluded_contestants.filter(pk=contestant.pk).exists():
            return Response({'error': f'You’ve been excused from scoring {contestant.name} (conflict of interest).'}, status=403)
        criteria = list(rnd.criteria.all())
        raw = request.data.get('scores') or {}
        if not isinstance(raw, dict):
            return Response({'error': 'Scores must be an object.'}, status=400)
        submit = request.data.get('submit') is True
        scores, errors = {}, {}
        for c in criteria:
            v = raw.get(str(c.id))
            if v in (None, ''):
                if submit:
                    errors[str(c.id)] = f'Score {c.name} before submitting.'
                continue
            try:
                d = Decimal(str(v))
            except (InvalidOperation, ValueError):
                errors[str(c.id)] = f'{c.name} must be a number.'
                continue
            if d < 0 or d > c.max_points:
                errors[str(c.id)] = f'{c.name} must be between 0 and {c.max_points:g}.'
                continue
            scores[str(c.id)] = float(d)
        if errors:
            return Response({'error': ' '.join(errors.values()), 'fields': errors}, status=400)
        with transaction.atomic():
            sheet, _ = ScoreSheet.objects.select_for_update().get_or_create(round=rnd, judge=judge, contestant=contestant)
            if sheet.status == ScoreSheet.Status.SUBMITTED:
                return Response({'error': 'You’ve already submitted this sheet. Ask the organizer to unlock it to change it.'},
                                status=status.HTTP_409_CONFLICT)
            sheet.scores = scores
            sheet.comment = (request.data.get('comment') or '').strip()[:2000]
            if submit:
                sheet.status = ScoreSheet.Status.SUBMITTED
                sheet.submitted_at = timezone.now()
            sheet.save()
        return Response({'id': str(sheet.id), 'scores': sheet.scores, 'comment': sheet.comment, 'status': sheet.status,
                         'submitted_at': sheet.submitted_at, 'percent': round(sheet_percent(sheet.scores, criteria), 2),
                         'message': 'Scores submitted.' if submit else 'Draft saved.'})
