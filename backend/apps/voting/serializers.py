from django.db import transaction
from django.db.models import Count, IntegerField, Prefetch, Q, Sum, Value
from django.db.models.functions import Coalesce
from rest_framework import serializers

from .models import Candidate, Poll


COUNTED = Q(votes__is_void=False)


def candidates_with_counts():
    # Votes that count: not voided by the organizer; contest votes can carry several votes in one row
    return Candidate.objects.annotate(
        vote_total=Coalesce(Sum('votes__quantity', filter=COUNTED & Q(votes__category__isnull=True)), Value(0), output_field=IntegerField())
    ).order_by('order', 'name')


def polls_with_counts(qs=None):
    qs = qs if qs is not None else Poll.objects.all()
    return (
        qs.select_related('event')
        .annotate(total_votes=Coalesce(Sum('votes__quantity', filter=COUNTED), Value(0), output_field=IntegerField()),
                  voters=Count('votes__voter_identifier', filter=COUNTED, distinct=True))
        .prefetch_related(Prefetch('candidates', queryset=candidates_with_counts()))
    )


class CandidateSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    votes = serializers.SerializerMethodField()

    class Meta:
        model = Candidate
        fields = ['id', 'poll', 'name', 'subtitle', 'description', 'photo_url', 'order', 'votes']
        read_only_fields = ['poll', 'votes']
        extra_kwargs = {'order': {'required': False}}

    def get_votes(self, obj):
        total = getattr(obj, 'vote_total', None)
        return total if total is not None else obj.votes.filter(is_void=False).aggregate(n=Sum('quantity'))['n'] or 0

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Give each candidate a name.')
        return value


class StandaloneCandidateSerializer(CandidateSerializer):
    """For /candidates/ CRUD where the poll is chosen explicitly."""

    id = serializers.UUIDField(read_only=True)

    class Meta(CandidateSerializer.Meta):
        read_only_fields = ['votes']


class PollSerializer(serializers.ModelSerializer):
    candidates = CandidateSerializer(many=True, required=False)
    total_votes = serializers.SerializerMethodField()
    voters = serializers.SerializerMethodField()
    registered = serializers.SerializerMethodField()
    event_title = serializers.CharField(source='event.title', read_only=True)
    event_slug = serializers.CharField(source='event.slug', read_only=True)
    max_choices = serializers.IntegerField(min_value=1, max_value=50, required=False)

    class Meta:
        model = Poll
        fields = [
            'id', 'event', 'event_title', 'event_slug', 'kind', 'slug', 'title', 'description',
            'status', 'opens_at', 'closes_at',
            'vote_mode', 'require_checked_in', 'allow_multiple', 'max_choices',
            'results_visibility', 'show_on_public_page', 'order',
            'candidates', 'total_votes', 'voters', 'registered', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'kind', 'slug', 'created_at', 'updated_at']

    def get_total_votes(self, obj):
        v = getattr(obj, 'total_votes', None)
        return v if v is not None else obj.votes.filter(is_void=False).aggregate(n=Sum('quantity'))['n'] or 0

    def get_voters(self, obj):
        v = getattr(obj, 'voters', None)
        return v if v is not None else obj.votes.filter(is_void=False).values('voter_identifier').distinct().count()

    def get_registered(self, obj):
        return obj.event.tickets.exclude(status='cancelled').count()

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Give the poll a title.')
        return value

    def validate(self, attrs):
        inst = self.instance
        get = lambda k, d=None: attrs.get(k, getattr(inst, k, d) if inst else d)  # noqa: E731
        if inst and 'event' in attrs and attrs['event'] != inst.event:
            raise serializers.ValidationError({'event': 'A poll can’t be moved to another event.'})
        # One-time codes are only verified for contests (the otp/ endpoints are contest-only)
        if get('kind', Poll.Kind.POLL) == Poll.Kind.POLL and get('vote_mode') in (Poll.VoteMode.EMAIL_OTP, Poll.VoteMode.SMS_OTP):
            raise serializers.ValidationError({'vote_mode': 'Quick polls can’t use one-time codes. Use a contest, or one vote per phone or email.'})
        status = get('status', Poll.Status.DRAFT)
        opens_at, closes_at = get('opens_at'), get('closes_at')
        if status == Poll.Status.SCHEDULED and not opens_at:
            raise serializers.ValidationError({'opens_at': 'Pick when voting should open.'})
        if opens_at and closes_at and closes_at <= opens_at:
            raise serializers.ValidationError({'closes_at': 'Voting must close after it opens.'})
        allow_multiple = get('allow_multiple', False)
        max_choices = get('max_choices', 1) or 1
        if not allow_multiple:
            attrs['max_choices'] = 1
        elif max_choices < 2:
            raise serializers.ValidationError({'max_choices': 'With multiple choice on, allow at least 2 picks.'})
        candidates = attrs.get('candidates')
        if candidates is not None:
            n = len(candidates)
            if allow_multiple and max_choices > n and n > 0:
                raise serializers.ValidationError({'max_choices': f'Voters can’t pick more than the {n} candidates on the ballot.'})
            ids = [str(c['id']) for c in candidates if c.get('id')]
            if inst and ids:
                own = {str(i) for i in inst.candidates.values_list('id', flat=True)}
                if not set(ids) <= own:
                    raise serializers.ValidationError({'candidates': 'One of the candidates belongs to another poll.'})
        if status == Poll.Status.OPEN:
            count = len(candidates) if candidates is not None else (inst.candidates.count() if inst else 0)
            if count < 2:
                raise serializers.ValidationError({'candidates': 'Add at least 2 candidates before opening voting.'})
        return attrs

    def _save_candidates(self, poll, candidates):
        keep = []
        existing = {str(c.id): c for c in poll.candidates.all()}
        for i, data in enumerate(candidates):
            cid = str(data.pop('id', '') or '')
            data['order'] = i
            if cid and cid in existing:
                cand = existing[cid]
                for k, v in data.items():
                    setattr(cand, k, v)
                cand.save()
            else:
                cand = Candidate.objects.create(poll=poll, **data)
            keep.append(cand.id)
        poll.candidates.exclude(id__in=keep).delete()

    @transaction.atomic
    def create(self, validated_data):
        candidates = validated_data.pop('candidates', [])
        poll = Poll.objects.create(**validated_data)
        self._save_candidates(poll, candidates)
        return poll

    @transaction.atomic
    def update(self, instance, validated_data):
        candidates = validated_data.pop('candidates', None)
        instance = super().update(instance, validated_data)
        if candidates is not None:
            self._save_candidates(instance, candidates)
        return instance


def public_poll_data(poll, counts=None):
    """Ballot data for attendees. Counts are only included when the organizer lets the public see them."""
    show = poll.results_public()
    cands = list(poll.candidates.all())
    total = sum(getattr(c, 'vote_total', 0) for c in cands)
    data = {
        'id': str(poll.id),
        'kind': poll.kind,
        'slug': poll.slug,
        'title': poll.title,
        'description': poll.description,
        'status': poll.status,
        'opens_at': poll.opens_at,
        'closes_at': poll.closes_at,
        'vote_mode': poll.vote_mode,
        'require_checked_in': poll.require_checked_in,
        'allow_multiple': poll.allow_multiple,
        'max_choices': poll.choices_allowed,
        'results_visible': show,
        'total_votes': total if show else None,
        'event': {'title': poll.event.title, 'slug': poll.event.slug},
        'candidates': [],
    }
    for c in cands:
        item = {
            'id': str(c.id),
            'name': c.name,
            'subtitle': c.subtitle,
            'description': c.description,
            'photo_url': c.photo_url,
        }
        if show:
            votes = getattr(c, 'vote_total', 0)
            item['votes'] = votes
            item['percentage'] = round(votes * 100 / total, 1) if total else 0
        data['candidates'].append(item)
    return data
