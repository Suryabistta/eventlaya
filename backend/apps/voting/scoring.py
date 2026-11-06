"""Contest results: public votes + judges' scores → weighted standings, tie-breaks, visibility, advancement."""
from statistics import median

from django.db import transaction
from django.db.models import Max, Sum
from django.utils import timezone

from .models import Candidate, ContestCategory, ContestRound, Poll, RoundEntry, ScoreSheet, Vote, audit


class ContestError(Exception):
    def __init__(self, message, code=400, error_code=None, **extra):
        super().__init__(message)
        self.message, self.code, self.error_code, self.extra = message, code, error_code, extra

    def payload(self):
        data = {'error': self.message}
        if self.error_code:
            data['code'] = self.error_code
        data.update(self.extra)
        return data


# ---------------------------------------------------------------------------
# Building blocks


def tallies(poll, rounds=None, category=None, main_only=True):
    """{candidate_id: (votes, last_vote_at)} of counted (not void) votes."""
    qs = Vote.objects.filter(poll=poll, is_void=False)
    if category is not None:
        qs = qs.filter(category=category)
    elif main_only:
        qs = qs.filter(category__isnull=True)
    if rounds is not None:
        qs = qs.filter(round__in=rounds)
    return {r['candidate']: (r['n'] or 0, r['last']) for r in qs.values('candidate').annotate(n=Sum('quantity'), last=Max('voted_at'))}


def sheet_percent(scores, criteria):
    """A judge's sheet as 0–100: Σ(points × weight) / Σ(max × weight)."""
    num = den = 0.0
    for c in criteria:
        mx, w = float(c.max_points), float(c.weight)
        try:
            pts = float(scores.get(str(c.id), 0) or 0)
        except (TypeError, ValueError):
            pts = 0.0
        num += min(max(pts, 0.0), mx) * w
        den += mx * w
    return num * 100 / den if den else 0.0


def aggregate(values, mode):
    if not values:
        return None
    values = sorted(values)
    if mode == ContestRound.JudgeAggregation.DROP_HIGH_LOW and len(values) >= 3:
        values = values[1:-1]
    if mode == ContestRound.JudgeAggregation.MEDIAN:
        return float(median(values))
    return sum(values) / len(values)


def effective_weights(rnd, judging=True):
    """(judges %, public %). judging=False when the judging module is off for the contest: public votes decide."""
    if rnd is None:
        return 0, 100
    jw = rnd.judge_weight if rnd.judging_enabled and judging else 0
    pw = rnd.public_weight if rnd.public_vote_enabled else 0
    if jw + pw == 0:
        if rnd.public_vote_enabled:
            pw = 100
        elif rnd.judging_enabled and judging:
            jw = 100
        else:
            pw = 100
    total = jw + pw
    return round(jw * 100 / total, 2), round(pw * 100 / total, 2)


def _tb_value(row, key):
    if key == 'judges':
        return -(row['judge_score'] or 0)
    if key == 'public':
        return -row['votes']
    if key == 'earliest':
        last = row['last_vote_at']
        return last.timestamp() if last else float('inf')
    if key == 'number':
        return row['number'] if row['number'] is not None else float('inf')
    if key.startswith('criterion:'):
        return -(row['criteria'].get(key.split(':', 1)[1]) or 0)
    return 0


# ---------------------------------------------------------------------------
# Standings


def round_standings(poll, rnd=None, detail=True, judging=None):
    """Ranked rows for a round (or the whole contest when it has no rounds).

    Row: contestant facts, votes, public_score, judge_score, judges_scored, criteria {id: avg points},
    judges [{judge_id, name, percent, comment}] (detail only), final, rank, tied.
    """
    if rnd is None:
        contestants = list(poll.candidates.exclude(status=Candidate.Status.WITHDRAWN))
        counts = tallies(poll)
        criteria, sheets = [], []
        public_norm = 'top'
        aggregation = ContestRound.JudgeAggregation.AVERAGE
        tie_breakers = ['public', 'earliest']
    else:
        entries = {e.contestant_id: e for e in rnd.entries.select_related('contestant')}
        contestants = [e.contestant for e in entries.values()]
        vote_rounds = list(poll.rounds.filter(order__lte=rnd.order)) if rnd.carry_over_votes else [rnd]
        counts = tallies(poll, rounds=vote_rounds)
        if judging is None:
            from .access import judging_counts
            judging = judging_counts(poll)
        # Judging module off: judges' scores don't count (and aren't shown)
        criteria = list(rnd.criteria.all()) if judging else []
        sheets = list(ScoreSheet.objects.filter(round=rnd, status=ScoreSheet.Status.SUBMITTED, judge__is_active=True)
                      .select_related('judge__user')) if judging else []
        public_norm = rnd.public_normalization
        aggregation = rnd.judge_aggregation
        tie_breakers = [t for t in (rnd.tie_breakers or []) if judging or not (t == 'judges' or t.startswith('criterion:'))]
    jw, pw = effective_weights(rnd, judging is not False)

    total_votes = sum(counts.get(c.id, (0, None))[0] for c in contestants)
    top_votes = max([counts.get(c.id, (0, None))[0] for c in contestants] or [0])
    by_contestant = {}
    for s in sheets:
        by_contestant.setdefault(s.contestant_id, []).append(s)

    rows = []
    for c in contestants:
        votes, last = counts.get(c.id, (0, None))
        if public_norm == ContestRound.PublicNormalization.SHARE:
            public_score = votes * 100 / total_votes if total_votes else 0.0
        else:
            public_score = votes * 100 / top_votes if top_votes else 0.0
        own = by_contestant.get(c.id, [])
        percents = [sheet_percent(s.scores or {}, criteria) for s in own]
        judge_score = aggregate(percents, aggregation)
        crit = {}
        for cr in criteria:
            vals = []
            for s in own:
                try:
                    vals.append(float((s.scores or {}).get(str(cr.id), 0) or 0))
                except (TypeError, ValueError):
                    vals.append(0.0)
            crit[str(cr.id)] = round(sum(vals) / len(vals), 2) if vals else None
        final = (jw * (judge_score or 0) + pw * public_score) / 100
        entry = entries.get(c.id) if rnd is not None else None
        row = {
            'contestant_id': str(c.id), 'name': c.name, 'number': c.number, 'display_number': poll.format_number(c.number),
            'slug': c.slug, 'photo_url': c.photo_url, 'subtitle': c.subtitle, 'status': c.status,
            'entry_status': entry.status if entry else None,
            'votes': votes, 'last_vote_at': last,
            'public_score': round(public_score, 2),
            'judge_score': round(judge_score, 2) if judge_score is not None else None,
            'judges_scored': len(own),
            'criteria': crit,
            'final': round(final, 4),
        }
        if detail:
            row['judges'] = [{'judge_id': str(s.judge_id), 'name': s.judge.display_name,
                              'percent': round(sheet_percent(s.scores or {}, criteria), 2), 'comment': s.comment,
                              'scores': s.scores} for s in own]
        rows.append(row)

    def key(r):
        return (r['status'] == Candidate.Status.WITHDRAWN, -r['final'], *[_tb_value(r, k) for k in tie_breakers])

    rows.sort(key=lambda r: (*key(r), r['number'] if r['number'] is not None else float('inf'), r['name'].lower()))
    prev, rank = None, 0
    for i, r in enumerate(rows):
        k = key(r)
        if k != prev:
            rank, prev = i + 1, k
            r['tied'] = False
        else:
            r['tied'] = True
            rows[i - 1]['tied'] = True
        r['rank'] = rank
    for r in rows:
        r['last_vote_at'] = r['last_vote_at'].isoformat() if r['last_vote_at'] else None

    cutoff = rnd.advance_count if rnd is not None else None
    tie_at_cutoff = bool(cutoff and len(rows) > cutoff and rows[cutoff - 1]['rank'] == rows[cutoff]['rank'])
    return {
        'round': round_brief(rnd) if rnd else None,
        'weights': {'judges': jw, 'public': pw},
        'public_normalization': public_norm,
        'judge_aggregation': aggregation,
        'tie_breakers': tie_breakers,
        'criteria': [{'id': str(c.id), 'name': c.name, 'max_points': float(c.max_points), 'weight': float(c.weight)} for c in criteria],
        'total_votes': total_votes,
        'advance_count': cutoff,
        'tie_at_cutoff': tie_at_cutoff,
        'rows': rows,
    }


def round_brief(rnd):
    return {
        'id': str(rnd.id), 'name': rnd.name, 'order': rnd.order, 'status': rnd.computed_status(),
        'opens_at': rnd.opens_at, 'closes_at': rnd.closes_at, 'public_vote_enabled': rnd.public_vote_enabled,
        'judging_enabled': rnd.judging_enabled, 'advance_count': rnd.advance_count, 'advance_mode': rnd.advance_mode,
        'finalized_at': rnd.finalized_at,
    }


# ---------------------------------------------------------------------------
# Visibility for the public


def visibility(poll, rnd=None, category=None):
    """('full' | 'ranks' | 'top' | 'none', top_n) for public readers."""
    mode = (category.results_visibility if category is not None and category.results_visibility else None) \
        or (rnd.results_visibility if rnd is not None and rnd.results_visibility else None) \
        or poll.results_visibility
    n = (rnd.results_top_n if rnd is not None and rnd.results_top_n else None) or poll.results_top_n or 3
    closed = poll.status == Poll.Status.CLOSED or (rnd is not None and rnd.computed_status() == ContestRound.Status.CLOSED)
    V = Poll.ResultsVisibility
    if mode == V.LIVE:
        return 'full', n
    if mode == V.AFTER_CLOSE:
        return ('full' if closed else 'none'), n
    if mode == V.RANKS_ONLY:
        return 'ranks', n
    if mode == V.TOP_N:
        return 'top', n
    return 'none', n


def public_standings(poll, rnd=None, category=None):
    """Standings trimmed to what the public may see; None when hidden."""
    level, n = visibility(poll, rnd, category)
    if level == 'none':
        return None
    data = category_results(poll, category) if category is not None else round_standings(poll, rnd, detail=False)
    rows = data['rows']
    if level == 'top':
        rows = [r for r in rows if r['rank'] <= n]
    out = []
    for r in rows:
        item = {k: r.get(k) for k in ('contestant_id', 'name', 'display_number', 'number', 'slug', 'photo_url', 'rank', 'tied', 'status')}
        if level == 'full':
            item['votes'] = r.get('votes')
            item['percentage'] = round(r['votes'] * 100 / data['total_votes'], 1) if data.get('total_votes') else 0
            if poll.show_judge_breakdown and category is None:
                item.update({'public_score': r.get('public_score'), 'judge_score': r.get('judge_score'), 'final': r.get('final')})
        out.append(item)
    return {'level': level, 'top_n': n if level == 'top' else None, 'rows': out,
            'total_votes': data.get('total_votes') if level == 'full' else None,
            'weights': data.get('weights') if level == 'full' and poll.show_judge_breakdown else None}


# ---------------------------------------------------------------------------
# Categories


def category_results(poll, category):
    rows = []
    nominees = list(category.nominees.exclude(status=Candidate.Status.WITHDRAWN))
    if not nominees:
        nominees = list(poll.candidates.filter(status__in=[Candidate.Status.ACTIVE, Candidate.Status.WINNER]))
    total = 0
    if category.selection == ContestCategory.Selection.PUBLIC_VOTE:
        counts = tallies(poll, category=category)
        total = sum(counts.get(c.id, (0, None))[0] for c in nominees)
        for c in nominees:
            votes, last = counts.get(c.id, (0, None))
            rows.append({'contestant': c, 'votes': votes, 'score': votes, 'last': last})
        rows.sort(key=lambda r: (-r['score'], r['last'].timestamp() if r['last'] else float('inf'), r['contestant'].number or 0))
    elif category.selection == ContestCategory.Selection.JUDGES:
        from .access import judging_counts
        rnd = category.round or poll.rounds.filter(judging_enabled=True).order_by('-order').first()
        if rnd is not None and not judging_counts(poll):
            rnd = None  # judging module off: no judges' result
        if rnd is not None:
            st = round_standings(poll, rnd, detail=False)
            ids = {str(c.id) for c in nominees}
            for r in st['rows']:
                if r['contestant_id'] not in ids:
                    continue
                score = r['criteria'].get(str(category.criterion_id)) if category.criterion_id else r['judge_score']
                c = next(x for x in nominees if str(x.id) == r['contestant_id'])
                rows.append({'contestant': c, 'votes': r['votes'], 'score': score or 0, 'last': None})
        rows.sort(key=lambda r: (-r['score'], r['contestant'].number or 0))
    else:
        for c in nominees:
            rows.append({'contestant': c, 'votes': 0, 'score': 1 if category.winner_id == c.id else 0, 'last': None})
        rows.sort(key=lambda r: (-r['score'], r['contestant'].number or 0))
    out, prev, rank = [], None, 0
    for i, r in enumerate(rows):
        if r['score'] != prev:
            rank, prev = i + 1, r['score']
        c = r['contestant']
        out.append({'contestant_id': str(c.id), 'name': c.name, 'number': c.number, 'display_number': poll.format_number(c.number),
                    'slug': c.slug, 'photo_url': c.photo_url, 'status': c.status, 'votes': r['votes'],
                    'score': round(r['score'], 2) if isinstance(r['score'], float) else r['score'], 'rank': rank,
                    'tied': False})
    for i in range(1, len(out)):
        if out[i]['rank'] == out[i - 1]['rank']:
            out[i]['tied'] = out[i - 1]['tied'] = True
    no_votes = category.selection == ContestCategory.Selection.PUBLIC_VOTE and total == 0
    if no_votes or (category.selection == ContestCategory.Selection.MANUAL and not category.winner_id):
        for o in out:  # nothing decided yet: no ranks
            o['rank'], o['tied'] = None, False
    return {'category': {'id': str(category.id), 'name': category.name, 'selection': category.selection,
                         'winner_id': str(category.winner_id) if category.winner_id else None},
            'total_votes': total, 'rows': out}


# ---------------------------------------------------------------------------
# Advancement


def next_round_of(rnd):
    return rnd.poll.rounds.filter(order__gt=rnd.order).order_by('order').first()


@transaction.atomic
def decide_round(rnd, actor, contestant_ids=None):
    """Advance the chosen (or top N) contestants to the next round and eliminate the rest.
    On the final round, records final placements and marks the winner. Returns a summary dict."""
    rnd = ContestRound.objects.select_for_update().get(pk=rnd.pk)
    poll = rnd.poll
    if rnd.finalized_at:
        raise ContestError(f'{rnd.name} has already been decided. Undo it first to change who goes through.', 409, 'already_decided')
    standings = round_standings(poll, rnd, detail=False)
    rows = [r for r in standings['rows'] if r['status'] != Candidate.Status.WITHDRAWN]
    if not rows:
        raise ContestError(f'Nobody is in {rnd.name} yet.', 400)
    nxt = next_round_of(rnd)
    now = timezone.now()
    in_round = {r['contestant_id'] for r in rows}

    if nxt is not None:
        if contestant_ids is not None:
            chosen = [str(i) for i in contestant_ids]
            if not chosen:
                raise ContestError('Pick at least one contestant to go through.', 400)
            if not set(chosen) <= in_round:
                raise ContestError('One of the picked contestants isn’t in this round.', 400)
        else:
            if rnd.advance_mode == ContestRound.AdvanceMode.MANUAL:
                raise ContestError('This round uses manual advancement: pick who goes through.', 400, 'pick_required')
            n = rnd.advance_count
            if not n:
                raise ContestError('Set how many contestants go through, or pick them yourself.', 400, 'pick_required')
            if standings['tie_at_cutoff']:
                raise ContestError(f'There is a tie at place {n}. Pick who goes through yourself.', 409, 'tie_at_cutoff')
            chosen = [r['contestant_id'] for r in rows[:n]]
        chosen_set = set(chosen)
        for r in rows:
            adv = r['contestant_id'] in chosen_set
            RoundEntry.objects.filter(round=rnd, contestant_id=r['contestant_id']).update(
                status=RoundEntry.Status.ADVANCED if adv else RoundEntry.Status.ELIMINATED,
                rank=r['rank'], score=r['final'], decided_at=now)
            if adv:
                RoundEntry.objects.get_or_create(round=nxt, contestant_id=r['contestant_id'])
        Candidate.objects.filter(id__in=in_round - chosen_set, status=Candidate.Status.ACTIVE).update(status=Candidate.Status.ELIMINATED)
        summary = f'{rnd.name}: {len(chosen_set)} through to {nxt.name}, {len(in_round - chosen_set)} eliminated'
        result = {'advanced': chosen, 'eliminated': sorted(in_round - chosen_set), 'next_round': str(nxt.id)}
    else:
        if contestant_ids is not None:
            # Organizer fixes the final order (e.g. after a tie): ids in placement order
            order = [str(i) for i in contestant_ids]
            if not set(order) <= in_round:
                raise ContestError('One of the picked contestants isn’t in this round.', 400)
            rest = [r['contestant_id'] for r in rows if r['contestant_id'] not in set(order)]
            placement = order + rest
        else:
            if rows[0]['tied']:
                raise ContestError('The top place is tied. Set the final order yourself.', 409, 'tie_at_cutoff')
            placement = [r['contestant_id'] for r in rows]
        score_of = {r['contestant_id']: r['final'] for r in rows}
        for i, cid in enumerate(placement):
            RoundEntry.objects.filter(round=rnd, contestant_id=cid).update(
                status=RoundEntry.Status.PLACED, rank=i + 1, score=score_of.get(cid), decided_at=now)
        Candidate.objects.filter(id=placement[0]).update(status=Candidate.Status.WINNER)
        winner = Candidate.objects.get(pk=placement[0])
        summary = f'{rnd.name} decided: {poll.format_number(winner.number)} {winner.name} wins'.replace('  ', ' ')
        result = {'placement': placement, 'winner': placement[0]}
    rnd.finalized_at, rnd.finalized_by, rnd.status = now, actor if getattr(actor, 'is_authenticated', False) else None, ContestRound.Status.CLOSED
    if not rnd.closes_at or rnd.closes_at > now:
        rnd.closes_at = now
    rnd.save(update_fields=['finalized_at', 'finalized_by', 'status', 'closes_at'])
    audit(poll, actor, 'round_decided', summary, round=str(rnd.id), **result)
    return {'message': summary, **result}


@transaction.atomic
def undo_round(rnd, actor):
    rnd = ContestRound.objects.select_for_update().get(pk=rnd.pk)
    poll = rnd.poll
    if not rnd.finalized_at:
        raise ContestError(f'{rnd.name} hasn’t been decided yet.', 400)
    nxt = next_round_of(rnd)
    if nxt is not None:
        if Vote.objects.filter(round=nxt).exists() or ScoreSheet.objects.filter(round=nxt).exists():
            raise ContestError(f'{nxt.name} already has votes or scores, so this decision can’t be undone.', 409, 'next_round_started')
        nxt.entries.all().delete()
    eliminated = list(rnd.entries.filter(status=RoundEntry.Status.ELIMINATED).values_list('contestant_id', flat=True))
    Candidate.objects.filter(id__in=eliminated, status=Candidate.Status.ELIMINATED).update(status=Candidate.Status.ACTIVE)
    winners = list(rnd.entries.filter(status=RoundEntry.Status.PLACED, rank=1).values_list('contestant_id', flat=True))
    Candidate.objects.filter(id__in=winners, status=Candidate.Status.WINNER).update(status=Candidate.Status.ACTIVE)
    rnd.entries.update(status=RoundEntry.Status.COMPETING, rank=None, score=None, decided_at=None)
    rnd.finalized_at = None
    rnd.finalized_by = None
    rnd.save(update_fields=['finalized_at', 'finalized_by'])
    audit(poll, actor, 'round_undone', f'{rnd.name}: decision undone', round=str(rnd.id))
    return {'message': f'{rnd.name}: decision undone'}
