"""Serializers for contests (organizer side). Nested lists use replace-by-id semantics like poll candidates:
items with an id are updated, items without are created, missing ones are deleted."""
import re
from datetime import date

from django.conf import settings
from django.db import transaction
from django.db.models import Q, Sum
from django.utils.text import slugify
from rest_framework import serializers

from .models import (
    Candidate, ContestCategory, ContestJudge, ContestRound, Criterion, Poll, ProfileField, RoundEntry, ScoreSheet, Vote,
    VotePack,
)

SOCIAL_KEYS = ['facebook', 'instagram', 'tiktok', 'youtube', 'x', 'website']
TIE_BREAKERS = {'judges', 'public', 'earliest', 'number'}
UUID_RE = re.compile(r'^[0-9a-fA-F-]{32,36}$')


def clean_image_url(value, what='photo'):
    value = (value or '').strip()
    if value and not (value.startswith(f'{settings.MEDIA_URL}uploads/') or value.startswith('https://')):
        raise serializers.ValidationError(f'Upload the {what} with the image uploader.')
    if '..' in value:
        raise serializers.ValidationError('That image address is not allowed.')
    return value


def unique_slug(base, taken, fallback='item'):
    base = slugify(base)[:70] or fallback
    slug, i = base, 2
    while slug in taken:
        slug = f'{base}-{i}'
        i += 1
    return slug


# ---------------------------------------------------------------------------
# Contestants


class ContestantSerializer(serializers.ModelSerializer):
    display_number = serializers.SerializerMethodField()
    votes = serializers.SerializerMethodField()
    categories = serializers.SerializerMethodField()
    rounds = serializers.SerializerMethodField()
    number = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=99999)

    class Meta:
        model = Candidate
        fields = ['id', 'poll', 'name', 'subtitle', 'description', 'photo_url', 'gallery', 'social_links', 'profile',
                  'number', 'display_number', 'slug', 'status', 'order', 'votes', 'categories', 'rounds',
                  'created_at', 'updated_at']
        read_only_fields = ['id', 'poll', 'display_number', 'votes', 'categories', 'rounds', 'created_at', 'updated_at']
        extra_kwargs = {'slug': {'required': False}, 'order': {'required': False}}

    @property
    def poll(self):
        return self.context['poll']

    def get_display_number(self, obj):
        return self.poll.format_number(obj.number)

    def get_votes(self, obj):
        v = getattr(obj, 'vote_total', None)
        if v is None:
            v = obj.votes.filter(is_void=False, category__isnull=True).aggregate(n=Sum('quantity'))['n'] or 0
        return v

    def get_categories(self, obj):
        return [str(c.id) for c in obj.categories.all()]

    def get_rounds(self, obj):
        return [{'round_id': str(e.round_id), 'status': e.status, 'rank': e.rank} for e in obj.round_entries.all()]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Give each contestant a name.')
        return value

    def validate_photo_url(self, value):
        return clean_image_url(value)

    def validate_gallery(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Gallery must be a list of image addresses.')
        if len(value) > 20:
            raise serializers.ValidationError('Up to 20 gallery photos.')
        return [clean_image_url(str(v), 'gallery photo') for v in value if str(v).strip()]

    def validate_social_links(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError('Social links must be an object.')
        out = {}
        for k, v in value.items():
            v = (str(v) if v is not None else '').strip()
            if not v:
                continue
            if k not in SOCIAL_KEYS:
                raise serializers.ValidationError(f'Unknown link “{k}”. Use one of: {", ".join(SOCIAL_KEYS)}.')
            if not re.match(r'^https?://', v):
                v = 'https://' + v.lstrip('/')
            if len(v) > 300 or ' ' in v:
                raise serializers.ValidationError(f'The {k} link doesn’t look right.')
            out[k] = v
        return out

    def validate_slug(self, value):
        return slugify(value or '')[:80]

    def validate_profile(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError('Profile must be an object.')
        fields = {f.key: f for f in self.poll.profile_fields.all()}
        out = {}
        for k, v in value.items():
            f = fields.get(k)
            if f is None:
                continue  # field was removed: drop the stale value
            v = '' if v is None else str(v).strip()
            if not v:
                continue
            if f.field_type == ProfileField.Type.NUMBER:
                try:
                    float(v)
                except ValueError:
                    raise serializers.ValidationError(f'{f.label} must be a number.')
            elif f.field_type == ProfileField.Type.SELECT and f.options and v not in f.options:
                raise serializers.ValidationError(f'{f.label} must be one of: {", ".join(f.options)}.')
            elif f.field_type == ProfileField.Type.DATE:
                try:
                    date.fromisoformat(v)
                except ValueError:
                    raise serializers.ValidationError(f'{f.label} must be a date (YYYY-MM-DD).')
            out[k] = v[:500]
        return out

    def validate(self, attrs):
        poll = self.poll
        inst = self.instance
        number = attrs.get('number', inst.number if inst else None)
        if number is not None:
            clash = poll.candidates.filter(number=number)
            if inst:
                clash = clash.exclude(pk=inst.pk)
            if clash.exists():
                raise serializers.ValidationError({'number': f'{poll.format_number(number)} is already taken by {clash.first().name}.'})
        if 'slug' in attrs and attrs['slug']:
            clash = poll.candidates.filter(slug=attrs['slug'])
            if inst:
                clash = clash.exclude(pk=inst.pk)
            if clash.exists():
                raise serializers.ValidationError({'slug': 'Another contestant already uses this link name.'})
        profile = attrs.get('profile', inst.profile if inst else {})
        missing = [f.label for f in poll.profile_fields.filter(required=True) if not (profile or {}).get(f.key)]
        if missing and ('profile' in attrs or not inst):
            raise serializers.ValidationError({'profile': f'Fill in: {", ".join(missing)}.'})
        return attrs

    def create(self, validated):
        poll = self.poll
        if validated.get('number') is None:
            validated['number'] = next_number(poll)
        if not validated.get('slug'):
            validated['slug'] = unique_slug(validated['name'], set(poll.candidates.values_list('slug', flat=True)), 'contestant')
        validated.setdefault('order', poll.candidates.count())
        c = Candidate.objects.create(poll=poll, **validated)
        add_to_first_round(poll, [c])
        return c

    def update(self, inst, validated):
        if 'slug' in validated and not validated['slug']:
            validated['slug'] = unique_slug(validated.get('name', inst.name),
                                            set(self.poll.candidates.exclude(pk=inst.pk).values_list('slug', flat=True)), 'contestant')
        return super().update(inst, validated)


def next_number(poll):
    top = poll.candidates.exclude(number__isnull=True).order_by('-number').values_list('number', flat=True).first()
    return (top or 0) + 1


def add_to_first_round(poll, contestants):
    """New contestants join the first round while it hasn't been decided."""
    first = poll.rounds.order_by('order').first()
    if first is not None and not first.finalized_at:
        for c in contestants:
            RoundEntry.objects.get_or_create(round=first, contestant=c)


# ---------------------------------------------------------------------------
# Contest configuration


class CriterionSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)

    class Meta:
        model = Criterion
        fields = ['id', 'name', 'description', 'max_points', 'weight', 'order']
        extra_kwargs = {'order': {'required': False}}

    def validate_max_points(self, v):
        if v <= 0:
            raise serializers.ValidationError('Max points must be more than 0.')
        return v

    def validate_weight(self, v):
        if v < 0:
            raise serializers.ValidationError('Weight can’t be negative.')
        return v


class RoundSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    criteria = CriterionSerializer(many=True, required=False)
    computed_status = serializers.SerializerMethodField()
    contestants = serializers.SerializerMethodField()

    class Meta:
        model = ContestRound
        fields = ['id', 'name', 'order', 'status', 'computed_status', 'opens_at', 'closes_at', 'public_vote_enabled',
                  'judging_enabled', 'judge_weight', 'public_weight', 'public_normalization', 'judge_aggregation',
                  'advance_count', 'advance_mode', 'carry_over_votes', 'tie_breakers', 'results_visibility',
                  'results_top_n', 'finalized_at', 'criteria', 'contestants']
        read_only_fields = ['finalized_at', 'computed_status', 'contestants']
        extra_kwargs = {'order': {'required': False}}

    def get_computed_status(self, obj):
        return obj.computed_status()

    def get_contestants(self, obj):
        return [{'contestant_id': str(e.contestant_id), 'status': e.status, 'rank': e.rank, 'score': e.score} for e in obj.entries.all()]

    def validate_name(self, v):
        v = v.strip()
        if not v:
            raise serializers.ValidationError('Name each round.')
        return v

    def validate_tie_breakers(self, v):
        if not isinstance(v, list):
            raise serializers.ValidationError('Tie-breakers must be a list.')
        for item in v:
            if item not in TIE_BREAKERS and not (isinstance(item, str) and item.startswith('criterion:')):
                raise serializers.ValidationError(f'Unknown tie-breaker “{item}”.')
        return v

    def validate(self, attrs):
        for k in ('judge_weight', 'public_weight'):
            if attrs.get(k, 0) > 100:
                raise serializers.ValidationError({k: 'Use a percentage from 0 to 100.'})
        if attrs.get('opens_at') and attrs.get('closes_at') and attrs['closes_at'] <= attrs['opens_at']:
            raise serializers.ValidationError({'closes_at': 'A round must close after it opens.'})
        if attrs.get('judging_enabled') and attrs.get('public_vote_enabled', True) and \
                attrs.get('judge_weight', 0) + attrs.get('public_weight', 100) != 100:
            raise serializers.ValidationError({'judge_weight': 'Judges % and public % must add up to 100.'})
        return attrs


class ProfileFieldSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    key = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = ProfileField
        fields = ['id', 'key', 'label', 'field_type', 'options', 'is_public', 'required', 'order']
        extra_kwargs = {'order': {'required': False}}

    def validate_options(self, v):
        if not isinstance(v, list):
            raise serializers.ValidationError('Options must be a list.')
        return [str(o).strip()[:80] for o in v if str(o).strip()][:50]


class VotePackSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)

    class Meta:
        model = VotePack
        fields = ['id', 'label', 'votes', 'bonus_votes', 'price', 'is_active', 'order']
        extra_kwargs = {'order': {'required': False}}

    def validate_votes(self, v):
        if v < 1:
            raise serializers.ValidationError('A pack needs at least 1 vote.')
        return v


class CategorySerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    nominees = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)
    round_ref = serializers.CharField(required=False, allow_blank=True, allow_null=True, write_only=True)
    criterion_ref = serializers.CharField(required=False, allow_blank=True, allow_null=True, write_only=True)
    winner = serializers.UUIDField(required=False, allow_null=True, write_only=True)
    round_name = serializers.SerializerMethodField()
    criterion_name = serializers.SerializerMethodField()

    class Meta:
        model = ContestCategory
        fields = ['id', 'name', 'slug', 'description', 'order', 'selection', 'nominees', 'votes_per_voter', 'votes_per_day',
                  'results_visibility', 'round', 'criterion', 'round_ref', 'criterion_ref', 'round_name', 'criterion_name', 'winner']
        read_only_fields = ['round', 'criterion', 'round_name', 'criterion_name']
        extra_kwargs = {'order': {'required': False}, 'slug': {'required': False}}

    def to_representation(self, obj):
        data = super().to_representation(obj)
        data['nominees'] = [str(i) for i in obj.nominees.values_list('id', flat=True)]
        data['winner'] = str(obj.winner_id) if obj.winner_id else None
        return data

    def get_round_name(self, obj):
        return obj.round.name if obj.round_id else None

    def get_criterion_name(self, obj):
        return obj.criterion.name if obj.criterion_id else None

    def validate_name(self, v):
        v = v.strip()
        if not v:
            raise serializers.ValidationError('Name each category.')
        return v


SETTINGS_FIELDS = [
    'title', 'description', 'slug', 'cover_url', 'status', 'opens_at', 'closes_at', 'vote_mode', 'require_checked_in',
    'results_visibility', 'results_top_n', 'show_on_public_page', 'number_prefix', 'number_padding', 'main_vote_enabled',
    'free_votes_enabled', 'votes_per_voter', 'votes_per_day', 'votes_per_round', 'votes_per_contestant',
    'contestant_cap_period', 'allow_split', 'max_votes_per_submit', 'paid_votes_enabled', 'price_per_vote', 'currency',
    'max_packs_per_day', 'buy_and_vote',
    'captcha_enabled', 'ip_votes_per_minute', 'device_votes_per_minute', 'flag_ip_burst', 'flag_subnet_burst',
    'flag_device_voters', 'transparency_note', 'show_transparency', 'judges_see_others', 'show_judge_breakdown',
    'placement_titles',
]


class ContestSerializer(serializers.ModelSerializer):
    rounds = RoundSerializer(many=True, required=False)
    categories = CategorySerializer(many=True, required=False)
    profile_fields = ProfileFieldSerializer(many=True, required=False)
    vote_packs = VotePackSerializer(many=True, required=False)
    event_title = serializers.CharField(source='event.title', read_only=True)
    event_slug = serializers.CharField(source='event.slug', read_only=True)
    stats = serializers.SerializerMethodField()
    judges = serializers.SerializerMethodField()
    has_votes = serializers.SerializerMethodField()
    captcha_available = serializers.SerializerMethodField()
    sms_provider = serializers.SerializerMethodField()
    payments = serializers.SerializerMethodField()
    brand = serializers.SerializerMethodField()
    results_top_n = serializers.IntegerField(min_value=1, max_value=100, required=False)
    number_padding = serializers.IntegerField(min_value=0, max_value=5, required=False)
    max_votes_per_submit = serializers.IntegerField(min_value=1, max_value=1000, required=False)

    class Meta:
        model = Poll
        fields = ['id', 'event', 'event_title', 'event_slug', 'kind', 'preset', *SETTINGS_FIELDS,
                  'rounds', 'categories', 'profile_fields', 'vote_packs', 'stats', 'judges', 'has_votes',
                  'captcha_available', 'sms_provider', 'payments', 'brand', 'created_at', 'updated_at']
        read_only_fields = ['id', 'kind', 'preset', 'created_at', 'updated_at']
        extra_kwargs = {'slug': {'required': False}}

    def get_stats(self, obj):
        from apps.payments.services import money
        votes = Vote.objects.filter(poll=obj)
        counted = votes.filter(is_void=False)
        return {
            'contestants': obj.candidates.count(),
            'active_contestants': obj.candidates.filter(status=Candidate.Status.ACTIVE).count(),
            'votes': counted.aggregate(n=Sum('quantity'))['n'] or 0,
            'voters': counted.values('voter_identifier').distinct().count(),
            'flagged': votes.exclude(flags=[]).filter(is_void=False).count(),
            'void': votes.filter(is_void=True).count(),
            'paid_votes': counted.exclude(source=Vote.Source.FREE).aggregate(n=Sum('quantity'))['n'] or 0,
            'revenue': str(money(obj.purchases.filter(status='paid').aggregate(n=Sum('amount'))['n'] or 0)),
        }

    def get_judges(self, obj):
        return [{'id': str(j.id), 'name': j.display_name, 'email': j.user.email, 'is_active': j.is_active}
                for j in obj.judges.select_related('user')]

    def get_has_votes(self, obj):
        return obj.votes.exists()

    def get_captcha_available(self, obj):
        from .captcha import site_key
        return bool(site_key())

    def get_payments(self, obj):
        """Can this contest sell votes right now (for the organizer's builder)?"""
        from .vote_payments import UNAVAILABLE_TEXT, payments_status
        available, reason, providers = payments_status(obj, obj.event.organizer)
        return {'available': available, 'reason': reason, 'message': UNAVAILABLE_TEXT.get(reason) if reason else None,
                'providers': [p.public() for p in providers]}

    def get_brand(self, obj):
        """The organizer's colours, only when their white-label is approved (else the app keeps Eventlaya's brand)."""
        from apps.accounts.models import TenantBranding
        from apps.platform.models import WhiteLabelRequest
        organizer = obj.event.organizer
        if WhiteLabelRequest.approved_for(organizer) is None:
            return None
        b = TenantBranding.objects.filter(organizer=organizer).first()
        if b is None:
            return None
        return {'primary_color': b.primary_color, 'accent_color': b.accent_color, 'brand_name': b.brand_name, 'brand_logo': b.brand_logo}

    def get_sms_provider(self, obj):
        from .sms import provider_name
        return provider_name()

    def validate_title(self, v):
        v = v.strip()
        if not v:
            raise serializers.ValidationError('Give the contest a name.')
        return v

    def validate_slug(self, v):
        return slugify(v or '')[:80]

    def validate_cover_url(self, v):
        return clean_image_url(v, 'cover')

    def validate_placement_titles(self, v):
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            raise serializers.ValidationError('Placement titles must be a list of names.')
        return [x.strip()[:40] for x in v if x.strip()][:10]

    def validate(self, attrs):
        inst = self.instance
        get = lambda k: attrs.get(k, getattr(inst, k) if inst else None)  # noqa: E731
        if inst and 'event' in attrs and attrs['event'] != inst.event:
            raise serializers.ValidationError({'event': 'A contest can’t be moved to another event.'})
        if get('status') == Poll.Status.SCHEDULED and not get('opens_at'):
            raise serializers.ValidationError({'opens_at': 'Pick when voting should open.'})
        if get('opens_at') and get('closes_at') and get('closes_at') <= get('opens_at'):
            raise serializers.ValidationError({'closes_at': 'Voting must close after it opens.'})
        if get('free_votes_enabled') is not False and not any(get(k) for k in ('votes_per_voter', 'votes_per_day', 'votes_per_round')):
            raise serializers.ValidationError({'votes_per_voter': 'Set at least one free-vote limit (per contest, per day or per round).'})
        if get('paid_votes_enabled') and not attrs.get('vote_packs', None) and not (inst and inst.vote_packs.exists()) and not get('price_per_vote'):
            raise serializers.ValidationError({'vote_packs': 'Add a vote pack or a price per vote, or turn paid votes off.'})
        from .vote_payments import VERIFIED_MODES
        if get('paid_votes_enabled') and get('vote_mode') not in VERIFIED_MODES:
            raise serializers.ValidationError({'paid_votes_enabled': 'Paid votes need verified voters: use SMS code, email code, '
                                                                     'account or ticket verification.'})
        for p in attrs.get('vote_packs') or []:
            if p.get('price') is not None and p['price'] <= 0:
                raise serializers.ValidationError({'vote_packs': 'Each pack needs a price above Rs 0.'})
        slug = attrs.get('slug')
        if slug:
            event = attrs.get('event') or (inst.event if inst else None)
            clash = Poll.objects.filter(event=event, slug=slug)
            if inst:
                clash = clash.exclude(pk=inst.pk)
            if clash.exists():
                raise serializers.ValidationError({'slug': 'Another poll of this event already uses this link name.'})
        rounds = attrs.get('rounds')
        if rounds is not None and inst:
            keep = {str(r['id']) for r in rounds if r.get('id')}
            own = {str(i) for i in inst.rounds.values_list('id', flat=True)}
            if not keep <= own:
                raise serializers.ValidationError({'rounds': 'One of the rounds belongs to another contest.'})
            removed = own - keep
            if removed and (Vote.objects.filter(round_id__in=removed).exists() or ScoreSheet.objects.filter(round_id__in=removed).exists()):
                raise serializers.ValidationError({'rounds': 'A round with votes or scores can’t be removed.'})
        return attrs

    # --- saving

    def _sync(self, model, parent_field, parent, items, extra=None, m2m=None):
        existing = {str(o.id): o for o in model.objects.filter(**{parent_field: parent})}
        keep, objs = [], []
        for i, data in enumerate(items):
            data = dict(data)
            m2m_values = {k: data.pop(k) for k in (m2m or []) if k in data}
            oid = str(data.pop('id', '') or '')
            data['order'] = i
            if extra:
                data.update(extra(data))
            if oid and oid in existing:
                obj = existing[oid]
                for k, v in data.items():
                    setattr(obj, k, v)
                obj.save()
            else:
                obj = model.objects.create(**{parent_field: parent}, **data)
            for k, v in m2m_values.items():
                getattr(obj, k).set(v)
            keep.append(obj.id)
            objs.append(obj)
        model.objects.filter(**{parent_field: parent}).exclude(id__in=keep).delete()
        return objs

    def _save_nested(self, poll, rounds, categories, profile_fields, vote_packs):
        if profile_fields is not None:
            taken = set()
            for f in profile_fields:
                f['key'] = unique_slug(f.get('key') or f['label'], taken, 'field').replace('-', '_')[:40]
                taken.add(f['key'])
            self._sync(ProfileField, 'poll', poll, profile_fields)
        if vote_packs is not None:
            self._sync(VotePack, 'poll', poll, vote_packs)
        if rounds is not None:
            first_new = not poll.rounds.exists()
            for r in rounds:
                crits = r.pop('criteria', None)
                r['_criteria'] = crits
            saved = self._sync(ContestRound, 'poll', poll, [{k: v for k, v in r.items() if k != '_criteria'} for r in rounds])
            for rnd, r in zip(saved, rounds):
                if r['_criteria'] is not None:
                    self._sync(Criterion, 'round', rnd, r['_criteria'])
            if first_new and saved:
                add_to_first_round(poll, list(poll.candidates.exclude(status=Candidate.Status.WITHDRAWN)))
        if categories is not None:
            rounds_by = {**{str(r.id): r for r in poll.rounds.all()}, **{r.name.lower(): r for r in poll.rounds.all()}}
            taken = set()
            items = []
            for c in categories:
                c = dict(c)
                rref = (c.pop('round_ref', None) or '').strip()
                cref = (c.pop('criterion_ref', None) or '').strip()
                rnd = rounds_by.get(rref) or rounds_by.get(rref.lower()) if rref else None
                crit = None
                if cref:
                    qs = Criterion.objects.filter(round__poll=poll)
                    if rnd is not None:
                        qs = qs.filter(round=rnd)
                    crit = qs.filter(id=cref).first() if UUID_RE.match(cref) else None
                    crit = crit or qs.filter(name__iexact=cref).order_by('-round__order').first()
                    if crit and rnd is None:
                        rnd = crit.round
                c['round'], c['criterion'] = rnd, crit
                winner = c.pop('winner', None)
                c['winner'] = poll.candidates.filter(pk=winner).first() if winner else None
                nominees = [str(n) for n in c.get('nominees', [])]
                c['nominees'] = list(poll.candidates.filter(id__in=nominees))
                c['slug'] = unique_slug(c.get('slug') or c['name'], taken, 'category')
                taken.add(c['slug'])
                items.append(c)
            self._sync(ContestCategory, 'poll', poll, items, m2m=['nominees'])

    @transaction.atomic
    def create(self, validated):
        nested = [validated.pop(k, None) for k in ('rounds', 'categories', 'profile_fields', 'vote_packs')]
        validated['kind'] = Poll.Kind.CONTEST
        if not validated.get('slug'):
            validated['slug'] = unique_slug(validated['title'], set(Poll.objects.filter(event=validated['event']).values_list('slug', flat=True)), 'contest')
        poll = Poll.objects.create(**validated)
        self._save_nested(poll, *nested)
        return poll

    @transaction.atomic
    def update(self, inst, validated):
        nested = [validated.pop(k, None) for k in ('rounds', 'categories', 'profile_fields', 'vote_packs')]
        if 'slug' in validated and not validated['slug']:
            validated['slug'] = unique_slug(validated.get('title', inst.title),
                                            set(Poll.objects.filter(event=inst.event).exclude(pk=inst.pk).values_list('slug', flat=True)), 'contest')
        inst = super().update(inst, validated)
        self._save_nested(inst, *nested)
        return inst


def contest_qs():
    return Poll.objects.filter(kind=Poll.Kind.CONTEST).select_related('event').prefetch_related(
        'rounds__criteria', 'rounds__entries', 'categories__nominees', 'categories__round', 'categories__criterion',
        'profile_fields', 'vote_packs',
    )


# ---------------------------------------------------------------------------
# Judges


def judge_progress(judge):
    """Per judging round: {round_id, name, expected, submitted, drafts}."""
    out = []
    excluded = set(judge.excluded_contestants.values_list('id', flat=True))
    for rnd in judge.poll.rounds.filter(judging_enabled=True):
        ids = set(rnd.entries.exclude(contestant__status=Candidate.Status.WITHDRAWN).values_list('contestant_id', flat=True)) - excluded
        sheets = ScoreSheet.objects.filter(round=rnd, judge=judge, contestant_id__in=ids)
        out.append({'round_id': str(rnd.id), 'name': rnd.name, 'expected': len(ids),
                    'submitted': sheets.filter(status=ScoreSheet.Status.SUBMITTED).count(),
                    'drafts': sheets.filter(status=ScoreSheet.Status.DRAFT).count()})
    return out


def judge_data(judge):
    return {
        'id': str(judge.id), 'user_id': str(judge.user_id), 'name': judge.display_name, 'email': judge.user.email,
        'is_active': judge.is_active, 'excluded_contestants': [str(i) for i in judge.excluded_contestants.values_list('id', flat=True)],
        'invited_at': judge.invited_at, 'last_login': judge.user.last_login, 'progress': judge_progress(judge),
    }


def contestants_qs(poll):
    return (poll.candidates.annotate(vote_total=Sum('votes__quantity', filter=Q(votes__is_void=False, votes__category__isnull=True)))
            .prefetch_related('categories', 'round_entries').order_by('order', 'number', 'name'))
