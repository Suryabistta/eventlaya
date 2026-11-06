"""Public contest API (/api/voting/public/<event>/contests/<contest>/…) and Open Graph pages for link previews.

Scoped like every public endpoint: white-label sites only see their organizer's events (tenancy.scope_events).
"""
from django.conf import settings
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.html import escape
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from apps.accounts.authentication import OptionalJWTAuthentication
from . import captcha
from .access import CONTESTS, require
from .credits import pack_price
from .models import Candidate, ContestCategory, Poll
from .otp import OTPError, channel_for, send_code, verify_code
from .rules import (
    UUID_RE, VoteError, allowance_summary, cast_contest_vote, client_ip, current_round, display_round, eligible_ids,
    find_contestant, network_hashes, resolve_voter, sync_rounds,
)
from .scoring import public_standings, round_brief


class OTPThrottle(SimpleRateThrottle):
    scope = 'vote_otp'
    rate = '10/min'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class BuyThrottle(OTPThrottle):
    scope = 'vote_buy'
    rate = '10/min'


def get_public_contest(request, slug, ref):
    from .views import get_public_event, sync_due_polls
    sync_due_polls()
    event = get_public_event(slug, request)
    qs = Poll.objects.filter(event=event, kind=Poll.Kind.CONTEST).exclude(status=Poll.Status.DRAFT).select_related('event')
    poll = (qs.filter(pk=ref).first() if UUID_RE.match(str(ref)) else None) or qs.filter(slug=str(ref).lower()).first()
    if poll is None:
        raise Http404('No such contest')
    require(CONTESTS, request, poll)
    sync_rounds(poll)
    return poll


def contestant_public(poll, c, fields, in_round=None, detail=False):
    data = {
        'id': str(c.id), 'number': c.number, 'display_number': poll.format_number(c.number), 'slug': c.slug, 'name': c.name,
        'subtitle': c.subtitle, 'photo_url': c.photo_url, 'status': c.status,
        'categories': [str(x.id) for x in c.categories.all()],
        'in_current_round': in_round,
    }
    public_profile = [{'key': f.key, 'label': f.label, 'value': (c.profile or {}).get(f.key)} for f in fields
                      if f.is_public and (c.profile or {}).get(f.key)]
    data['profile'] = public_profile
    if detail:
        data.update({'description': c.description, 'gallery': c.gallery or [], 'social_links': c.social_links or {}})
    return data


def paid_public(poll, request=None):
    """Paid votes for the public (web + mobile): what's on sale and whether it can be bought right now."""
    from .vote_payments import HIDDEN_REASONS, MAX_CUSTOM_VOTES, UNAVAILABLE_TEXT, payments_status
    user = getattr(request, 'user', None)
    available, reason, providers = payments_status(poll, user if user is not None and user.is_authenticated else None)
    # enabled = show the packs at all; payments_available = they can be bought right now
    on = poll.paid_votes_enabled and reason not in HIDDEN_REASONS
    return {
        'enabled': on,
        'payments_available': available,
        'unavailable_reason': reason,
        'unavailable_message': UNAVAILABLE_TEXT.get(reason) if reason and reason != 'off' else None,
        'providers': [p.public() for p in providers] if available else [],
        'currency': poll.currency,
        'price_per_vote': str(poll.price_per_vote) if on and poll.price_per_vote is not None else None,
        'custom_votes': bool(on and poll.price_per_vote),
        'max_custom_votes': MAX_CUSTOM_VOTES,
        'max_packs_per_day': poll.max_packs_per_day,
        'buy_and_vote': poll.buy_and_vote,
        'packs': [{**pack_price(p), 'khalti_ok': p.price >= 10} for p in poll.vote_packs.filter(is_active=True)] if on else [],
    }


def contest_public_data(poll, request=None, with_contestants=True):
    rnd = current_round(poll)
    shown = display_round(poll)
    has_rounds = poll.rounds.exists()
    poll_open = poll.status == Poll.Status.OPEN
    main_open = poll_open and poll.main_vote_enabled and (not has_rounds or (rnd is not None and rnd.public_vote_enabled))
    fields = list(poll.profile_fields.all())
    data = {
        'id': str(poll.id), 'kind': 'contest', 'slug': poll.slug, 'title': poll.title, 'description': poll.description,
        'cover_url': poll.cover_url, 'status': poll.status, 'opens_at': poll.opens_at, 'closes_at': poll.closes_at,
        'event': {'title': poll.event.title, 'slug': poll.event.slug},
        'vote_mode': poll.vote_mode, 'require_checked_in': poll.require_checked_in,
        'verification': {'method': poll.vote_mode, 'channel': channel_for(poll),
                         'captcha_site_key': captcha.site_key() if captcha.captcha_active(poll) else None},
        'rules': {
            'free_votes_enabled': poll.free_votes_enabled, 'votes_per_voter': poll.votes_per_voter, 'votes_per_day': poll.votes_per_day,
            'votes_per_round': poll.votes_per_round, 'votes_per_contestant': poll.votes_per_contestant,
            'contestant_cap_period': poll.contestant_cap_period, 'allow_split': poll.allow_split,
            'max_votes_per_submit': poll.max_votes_per_submit, 'main_vote_enabled': poll.main_vote_enabled,
        },
        'paid': paid_public(poll, request),
        'number_prefix': poll.number_prefix, 'number_padding': poll.number_padding,
        'profile_fields': [{'key': f.key, 'label': f.label, 'field_type': f.field_type, 'options': f.options} for f in fields if f.is_public],
        'rounds': [round_brief(r) for r in poll.rounds.all()],
        'current_round': round_brief(rnd) if rnd else None,
        'display_round': round_brief(shown) if shown else None,
        'voting_open': main_open,
        'categories': [],
        'standings': public_standings(poll, shown) if poll.main_vote_enabled or has_rounds else None,
        'placement_titles': poll.placement_titles,
        'transparency_note': poll.transparency_note if poll.show_transparency else '',
    }
    for cat in poll.categories.all().prefetch_related('nominees'):
        nominees = [str(n.id) for n in cat.nominees.all()]
        level = public_standings(poll, None, cat)
        winner = None
        if cat.winner_id and (level is not None or poll.status == Poll.Status.CLOSED):
            winner = str(cat.winner_id)
        data['categories'].append({
            'id': str(cat.id), 'slug': cat.slug, 'name': cat.name, 'description': cat.description, 'selection': cat.selection,
            'nominees': nominees, 'voting_open': poll_open and cat.selection == ContestCategory.Selection.PUBLIC_VOTE,
            'votes_per_voter': cat.votes_per_voter if cat.votes_per_voter is not None else poll.votes_per_voter,
            'votes_per_day': cat.votes_per_day if cat.votes_per_day is not None else poll.votes_per_day,
            'standings': level, 'winner': winner,
        })
    if with_contestants:
        in_round = eligible_ids(poll, None, rnd) if has_rounds and rnd else None
        data['contestants'] = [
            contestant_public(poll, c, fields, (c.id in in_round) if in_round is not None else None)
            for c in poll.candidates.prefetch_related('categories').order_by('order', 'number', 'name')
        ]
    return data


class PublicContestView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = [OptionalJWTAuthentication]

    def get(self, request, slug, ref):
        poll = get_public_contest(request, slug, ref)
        return Response(contest_public_data(poll, request))


class PublicContestantView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = [OptionalJWTAuthentication]

    def get(self, request, slug, ref, cref):
        poll = get_public_contest(request, slug, ref)
        c = find_contestant(poll, cref)
        if c is None:
            raise Http404('No such contestant')
        fields = list(poll.profile_fields.all())
        rnd = current_round(poll)
        in_round = c.id in eligible_ids(poll, None, rnd) if rnd else None
        data = contestant_public(poll, c, fields, in_round, detail=True)
        standings = public_standings(poll, display_round(poll))
        mine = next((r for r in (standings or {}).get('rows', []) if r['contestant_id'] == str(c.id)), None)
        data['standing'] = mine
        data['standing_level'] = standings['level'] if standings else 'none'
        contest = contest_public_data(poll, request, with_contestants=False)
        ids = list(poll.candidates.order_by('order', 'number', 'name').values_list('id', flat=True))
        i = ids.index(c.id)
        neighbours = Candidate.objects.filter(id__in=[ids[i - 1] if i > 0 else None, ids[i + 1] if i + 1 < len(ids) else None])
        nb = {n.id: {'id': str(n.id), 'name': n.name, 'display_number': poll.format_number(n.number), 'slug': n.slug, 'number': n.number}
              for n in neighbours}
        data['previous'] = nb.get(ids[i - 1]) if i > 0 else None
        data['next'] = nb.get(ids[i + 1]) if i + 1 < len(ids) else None
        return Response({'contest': contest, 'contestant': data})


class PublicContestVoteView(APIView):
    """POST {contestant (id|number|slug), category?, quantity?, voter_token|ticket_code|contact|device_id, captcha_token?}."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = [OptionalJWTAuthentication]

    def post(self, request, slug, ref):
        poll = get_public_contest(request, slug, ref)
        try:
            data = cast_contest_vote(poll, request.data, request)
        except VoteError as e:
            return Response(e.payload(), status=e.code)
        return Response(data, status=201)


class PublicBuyVotesView(APIView):
    """POST {pack | votes, provider, contestant?, return_url?, voter_token | ticket_code (or signed in), device_id,
    payer_name?, payer_phone?, payer_email?, captcha_token?} → {purchase, payment, checkout}. Then goToCheckout(checkout)."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = [OptionalJWTAuthentication]
    throttle_classes = [BuyThrottle]

    def post(self, request, slug, ref):
        from .vote_payments import PurchaseError, start_purchase
        poll = get_public_contest(request, slug, ref)
        try:
            return Response(start_purchase(poll, request.data, request), status=201)
        except PurchaseError as e:
            return Response(e.payload(), status=e.code)


class PublicContestAllowanceView(APIView):
    """POST the same identity fields as a vote (+ optional `contestant`: id | number | slug) → remaining free votes,
    credits, who you've voted for; with a contestant also contestant_free_remaining / contestant_used for them."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = [OptionalJWTAuthentication]

    def post(self, request, slug, ref):
        poll = get_public_contest(request, slug, ref)
        contestant = None
        if request.data.get('contestant'):
            contestant = find_contestant(poll, request.data.get('contestant'))
            if contestant is None:
                return Response({'error': 'That contestant isn’t in this contest.'}, status=404)
        try:
            voter_hash, _ = resolve_voter(poll, request.data, request)
        except VoteError as e:
            return Response(e.payload(), status=e.code)
        rnd = current_round(poll)
        out = {'main': allowance_summary(poll, voter_hash, None, rnd, contestant=contestant), 'categories': {}}
        for cat in poll.categories.filter(selection=ContestCategory.Selection.PUBLIC_VOTE):
            out['categories'][str(cat.id)] = allowance_summary(poll, voter_hash, cat, None, contestant=contestant)
        return Response(out)


class PublicOTPView(APIView):
    """POST send {destination, captcha_token?} | verify {destination, code}."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [OTPThrottle]

    def post(self, request, slug, ref, action):
        poll = get_public_contest(request, slug, ref)
        try:
            if action == 'send':
                if captcha.captcha_active(poll) and not captcha.verify(request.data.get('captcha_token'), client_ip(request)):
                    return Response({'error': 'Complete the “I’m not a robot” check first.', 'code': 'captcha_required'}, status=400)
                ip_hash = network_hashes(request, {})[0]
                return Response(send_code(poll, request.data.get('destination'), ip_hash))
            if action == 'verify':
                return Response(verify_code(poll, request.data.get('destination'), request.data.get('code')))
        except OTPError as e:
            body = {'error': e.message}
            if e.retry_after:
                body['retry_after'] = e.retry_after
            return Response(body, status=e.code)
        return Response({'error': 'Unknown action.'}, status=404)


# ---------------------------------------------------------------------------
# Open Graph pages. Chat apps (Facebook, Messenger, Viber, WhatsApp) don't run JavaScript, so the SPA can't give
# them a preview. Share buttons link here; crawlers read the tags, people are redirected to the SPA page at once.
# Self-contained so a later site-wide crawler-meta mechanism can call og_html() directly.


def absolute(request, url):
    if not url:
        return ''
    if url.startswith('http://') or url.startswith('https://'):
        return url
    return request.build_absolute_uri(url)


def og_html(title, description, image, url, site_name):
    t, d, i, u, s = (escape(x or '') for x in (title, description, image, url, site_name))
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{t}</title>
<meta name="description" content="{d}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{s}">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
{f'<meta property="og:image" content="{i}"><meta name="twitter:image" content="{i}">' if i else ''}
<meta property="og:url" content="{u}">
<meta name="twitter:card" content="{"summary_large_image" if i else "summary"}">
<meta name="twitter:title" content="{t}">
<meta name="twitter:description" content="{d}">
<link rel="canonical" href="{u}">
<meta http-equiv="refresh" content="0;url={u}">
</head><body><p><a href="{u}">{t}</a></p><script>location.replace({_js(u)})</script></body></html>'''


def _js(value):
    import json
    return json.dumps(value).replace('<', '\\u003c')


def spa_url(event, path):
    from apps.core.email import site_url
    return f'{site_url(event)}{path}'


class ContestOGView(APIView):
    """GET /api/voting/og/<event>/<contest>/ and …/c/<number-or-slug>/ → HTML with Open Graph tags."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request, slug, ref, cref=None):
        poll = get_public_contest(request, slug, ref)
        site = poll.event.title
        base = f'/e/{poll.event.slug}/vote/{poll.slug or poll.id}'
        if cref:
            c = find_contestant(poll, cref)
            if c is None:
                raise Http404('No such contestant')
            num = poll.format_number(c.number)
            title = f'Vote for {num} {c.name}'.replace('  ', ' ')
            desc = (c.description or c.subtitle or f'{c.name} is competing in {poll.title}. Tap to vote.')[:200]
            image = absolute(request, c.photo_url or poll.cover_url)
            url = spa_url(poll.event, f'{base}/c/{c.number if c.number is not None else c.slug}')
            title = f'{title} · {poll.title}'
        else:
            title = poll.title
            desc = (poll.description or f'Vote in {poll.title} at {poll.event.title}.')[:200]
            image = absolute(request, poll.cover_url or (poll.event.banner.url if poll.event.banner else ''))
            url = spa_url(poll.event, base)
        response = HttpResponse(og_html(title, desc, image, url, site), content_type='text/html; charset=utf-8')
        response['Cache-Control'] = 'public, max-age=300'
        return response
