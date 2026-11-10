"""Voting: quick audience polls and configurable contests / pageants.

A `Poll` row is either a quick poll (kind="poll", the original one-ballot-per-voter behaviour) or a contest
(kind="contest"): contestants with numbers and profiles, categories (sub-awards), rounds with eliminations,
judges' scoring, weighted results, OTP verification, vote allowances and an anti-fraud audit trail.
The data model is documented in docs/voting.md.
"""
import hashlib
import hmac
import uuid
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

NEPAL_TZ = ZoneInfo('Asia/Kathmandu')


def nepal_date(dt=None):
    """Calendar day in Nepal (daily vote allowances reset at midnight Asia/Kathmandu)."""
    return (dt or timezone.now()).astimezone(NEPAL_TZ).date()


def default_placement_titles():
    return ['Winner', '1st runner-up', '2nd runner-up']


def default_tie_breakers():
    return ['judges', 'public', 'earliest']


class Poll(models.Model):
    class Kind(models.TextChoices):
        POLL = 'poll', 'Quick poll'
        CONTEST = 'contest', 'Contest / pageant'

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        SCHEDULED = 'scheduled', 'Scheduled'
        OPEN = 'open', 'Open'
        CLOSED = 'closed', 'Closed'

    class VoteMode(models.TextChoices):
        TICKET = 'ticket', 'One vote per ticket'
        CONTACT = 'contact', 'One vote per phone or email'
        OPEN = 'open', 'Open (one per device)'
        ACCOUNT = 'account', 'Signed-in account'
        EMAIL_OTP = 'email_otp', 'Email one-time code'
        SMS_OTP = 'sms_otp', 'SMS one-time code'

    class ResultsVisibility(models.TextChoices):
        LIVE = 'live', 'Live'
        AFTER_CLOSE = 'after_close', 'After voting closes'
        HIDDEN = 'hidden_to_public', 'Hidden from the public'
        RANKS_ONLY = 'ranks_only', 'Ranks only (no counts)'
        TOP_N = 'top_n', 'Top N only'

    class CapPeriod(models.TextChoices):
        CONTEST = 'contest', 'Whole contest'
        DAY = 'day', 'Per day'
        ROUND = 'round', 'Per round'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey('events.Event', on_delete=models.CASCADE, related_name='polls')
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.POLL)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    # Contest URL part: /e/<event>/vote/<slug>. Unique per event when set.
    slug = models.SlugField(max_length=80, blank=True)
    preset = models.CharField(max_length=30, blank=True, help_text='Preset the contest was created from (informational)')
    cover_url = models.CharField(max_length=500, blank=True)

    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    opens_at = models.DateTimeField(null=True, blank=True)
    closes_at = models.DateTimeField(null=True, blank=True)

    vote_mode = models.CharField(max_length=10, choices=VoteMode.choices, default=VoteMode.TICKET)
    require_checked_in = models.BooleanField(default=False, help_text='Ticket voters must have been scanned in at the gate')
    allow_multiple = models.BooleanField(default=False)
    max_choices = models.PositiveSmallIntegerField(default=1)
    results_visibility = models.CharField(max_length=20, choices=ResultsVisibility.choices, default=ResultsVisibility.LIVE)
    results_top_n = models.PositiveSmallIntegerField(default=3)
    show_on_public_page = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)

    # --- Contest: contestant numbering ("#07")
    number_prefix = models.CharField(max_length=5, blank=True, default='#')
    number_padding = models.PositiveSmallIntegerField(default=2)

    # --- Contest: free vote allowance (null = no limit of that kind). Categories may override some of these.
    main_vote_enabled = models.BooleanField(default=True, help_text='Public can vote in the main contest (not only categories)')
    free_votes_enabled = models.BooleanField(default=True)
    votes_per_voter = models.PositiveIntegerField(null=True, blank=True, default=1, help_text='Free votes per voter for the whole contest')
    votes_per_day = models.PositiveIntegerField(null=True, blank=True, help_text='Free votes per voter per day (Nepal time)')
    votes_per_round = models.PositiveIntegerField(null=True, blank=True, help_text='Free votes per voter per round')
    votes_per_contestant = models.PositiveIntegerField(null=True, blank=True, help_text='Free votes one voter may give one contestant')
    contestant_cap_period = models.CharField(max_length=10, choices=CapPeriod.choices, default=CapPeriod.CONTEST)
    allow_split = models.BooleanField(default=True, help_text='Voters may spread votes over several contestants')
    max_votes_per_submit = models.PositiveIntegerField(default=1, help_text='Votes one submission may cast at once')

    # --- Contest: paid vote packs (stored now; payment collection is wired by apps.payments later)
    paid_votes_enabled = models.BooleanField(default=False)
    price_per_vote = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, default='NPR')
    max_packs_per_day = models.PositiveIntegerField(default=10, help_text='Vote-pack purchases per voter per day (0 = no limit)')
    # Off by default: bought votes land in the voter's balance and they vote themselves. On: a purchase made from a
    # contestant's page casts the votes for that contestant as soon as the payment is confirmed (if still eligible).
    buy_and_vote = models.BooleanField(default=False, help_text='Cast purchased votes for the chosen contestant automatically')

    # --- Contest: anti-fraud
    captcha_enabled = models.BooleanField(default=False, help_text='Cloudflare Turnstile (only when TURNSTILE_* env is set)')
    ip_votes_per_minute = models.PositiveIntegerField(default=30, help_text='0 = no limit')
    device_votes_per_minute = models.PositiveIntegerField(default=10, help_text='0 = no limit')
    flag_ip_burst = models.PositiveIntegerField(default=40, help_text='Flag when one IP casts this many votes in 10 minutes (0 = off)')
    flag_subnet_burst = models.PositiveIntegerField(default=150, help_text='Flag when one /24 subnet casts this many in 10 minutes (0 = off)')
    flag_device_voters = models.PositiveIntegerField(default=4, help_text='Flag when one device is used by this many voters (0 = off)')
    transparency_note = models.TextField(blank=True)
    show_transparency = models.BooleanField(default=False)

    # --- Contest: judges and display
    judges_see_others = models.BooleanField(default=False, help_text='Judges can see the other judges\' submitted scores')
    show_judge_breakdown = models.BooleanField(default=False, help_text='Public results show the judges/public split')
    placement_titles = models.JSONField(default=default_placement_titles, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'created_at']
        constraints = [
            models.UniqueConstraint(fields=['event', 'slug'], condition=~Q(slug=''), name='poll_slug_unique_per_event'),
        ]

    def __str__(self):
        return f"{self.title} ({self.event.title})"

    @property
    def is_contest(self):
        return self.kind == self.Kind.CONTEST

    @property
    def choices_allowed(self):
        return max(1, self.max_choices) if self.allow_multiple else 1

    def computed_status(self, now=None):
        """Status after applying the schedule: scheduled polls open at opens_at, open polls close at closes_at."""
        now = now or timezone.now()
        status = self.status
        if status == self.Status.SCHEDULED and self.opens_at and self.opens_at <= now:
            status = self.Status.OPEN
        if status in (self.Status.SCHEDULED, self.Status.OPEN) and self.closes_at and self.closes_at <= now:
            status = self.Status.CLOSED
        return status

    def sync_status(self, now=None):
        """Persist a schedule-driven transition so every reader sees the same state."""
        status = self.computed_status(now)
        if status != self.status:
            self.status = status
            Poll.objects.filter(pk=self.pk).update(status=status, updated_at=timezone.now())
        return status

    def results_public(self):
        if self.results_visibility in (self.ResultsVisibility.LIVE, self.ResultsVisibility.RANKS_ONLY, self.ResultsVisibility.TOP_N):
            return True
        if self.results_visibility == self.ResultsVisibility.AFTER_CLOSE:
            return self.status == self.Status.CLOSED
        return False

    def format_number(self, number):
        if number is None:
            return ''
        return f'{self.number_prefix}{str(number).zfill(self.number_padding or 1)}'


class Candidate(models.Model):
    """A poll option, or a contest contestant (number, profile, gallery, status)."""

    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        ELIMINATED = 'eliminated', 'Eliminated'
        WITHDRAWN = 'withdrawn', 'Withdrawn'
        WINNER = 'winner', 'Winner'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='candidates')
    name = models.CharField(max_length=255)
    subtitle = models.CharField(max_length=255, blank=True, help_text='Team, college or one-line tagline')
    description = models.TextField(blank=True)
    photo_url = models.CharField(max_length=500, blank=True)
    order = models.PositiveIntegerField(default=0)
    # Contest fields
    number = models.PositiveIntegerField(null=True, blank=True)
    slug = models.SlugField(max_length=80, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    gallery = models.JSONField(default=list, blank=True, help_text='Extra photo URLs from /api/uploads/')
    social_links = models.JSONField(default=dict, blank=True, help_text='{"facebook": url, "instagram": url, ...}')
    profile = models.JSONField(default=dict, blank=True, help_text='Values of the contest\'s custom profile fields, by key')
    # Added from an accepted application (event applications stage): that FormResponse, so it isn't imported twice
    application_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'name']
        constraints = [
            models.UniqueConstraint(fields=['poll', 'number'], condition=Q(number__isnull=False), name='candidate_number_unique_per_poll'),
            models.UniqueConstraint(fields=['poll', 'slug'], condition=~Q(slug=''), name='candidate_slug_unique_per_poll'),
        ]

    def __str__(self):
        return self.name

    @property
    def display_number(self):
        return self.poll.format_number(self.number)


class ProfileField(models.Model):
    """Organizer-defined contestant profile field (Age, Height, District…)."""

    class Type(models.TextChoices):
        TEXT = 'text', 'Text'
        NUMBER = 'number', 'Number'
        SELECT = 'select', 'Select'
        DATE = 'date', 'Date'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='profile_fields')
    key = models.SlugField(max_length=40)
    label = models.CharField(max_length=80)
    field_type = models.CharField(max_length=10, choices=Type.choices, default=Type.TEXT)
    options = models.JSONField(default=list, blank=True)
    is_public = models.BooleanField(default=True)
    required = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'label']
        constraints = [models.UniqueConstraint(fields=['poll', 'key'], name='profile_field_key_unique')]


class ContestRound(models.Model):
    class Status(models.TextChoices):
        UPCOMING = 'upcoming', 'Upcoming'
        OPEN = 'open', 'Open'
        CLOSED = 'closed', 'Closed'

    class PublicNormalization(models.TextChoices):
        TOP = 'top', 'Relative to the top contestant'
        SHARE = 'share', 'Percentage share of votes'

    class JudgeAggregation(models.TextChoices):
        AVERAGE = 'average', 'Average of judges'
        DROP_HIGH_LOW = 'drop_high_low', 'Drop highest and lowest, then average'
        MEDIAN = 'median', 'Median'

    class AdvanceMode(models.TextChoices):
        AUTO = 'auto', 'Top N by score'
        MANUAL = 'manual', 'Organizer picks'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='rounds')
    name = models.CharField(max_length=80)
    order = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.UPCOMING)
    opens_at = models.DateTimeField(null=True, blank=True)
    closes_at = models.DateTimeField(null=True, blank=True)
    public_vote_enabled = models.BooleanField(default=True)
    judging_enabled = models.BooleanField(default=False)
    judge_weight = models.PositiveSmallIntegerField(default=0, help_text='Percent of the final score from judges')
    public_weight = models.PositiveSmallIntegerField(default=100, help_text='Percent of the final score from public votes')
    public_normalization = models.CharField(max_length=10, choices=PublicNormalization.choices, default=PublicNormalization.TOP)
    judge_aggregation = models.CharField(max_length=15, choices=JudgeAggregation.choices, default=JudgeAggregation.AVERAGE)
    advance_count = models.PositiveIntegerField(null=True, blank=True, help_text='How many go through to the next round')
    advance_mode = models.CharField(max_length=10, choices=AdvanceMode.choices, default=AdvanceMode.AUTO)
    carry_over_votes = models.BooleanField(default=False, help_text='Public votes from earlier rounds count here too')
    tie_breakers = models.JSONField(default=default_tie_breakers, blank=True)
    results_visibility = models.CharField(max_length=20, choices=Poll.ResultsVisibility.choices, blank=True,
                                          help_text='Blank = the contest setting')
    results_top_n = models.PositiveSmallIntegerField(null=True, blank=True)
    finalized_at = models.DateTimeField(null=True, blank=True)
    finalized_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        ordering = ['order']

    def __str__(self):
        return self.name

    def computed_status(self, now=None):
        now = now or timezone.now()
        status = self.status
        if status == self.Status.UPCOMING and self.opens_at and self.opens_at <= now:
            status = self.Status.OPEN
        if status in (self.Status.UPCOMING, self.Status.OPEN) and self.closes_at and self.closes_at <= now:
            status = self.Status.CLOSED
        return status

    def sync_status(self, now=None):
        status = self.computed_status(now)
        if status != self.status:
            self.status = status
            ContestRound.objects.filter(pk=self.pk).update(status=status)
        return status


class Criterion(models.Model):
    """A judging criterion of a round, e.g. Talent (max 30 points, weight 1)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    round = models.ForeignKey(ContestRound, on_delete=models.CASCADE, related_name='criteria')
    name = models.CharField(max_length=80)
    description = models.CharField(max_length=255, blank=True)
    max_points = models.DecimalField(max_digits=6, decimal_places=2, default=10)
    weight = models.DecimalField(max_digits=6, decimal_places=2, default=1)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'name']

    def __str__(self):
        return self.name


class RoundEntry(models.Model):
    """A contestant taking part in a round; keeps the advancement history."""

    class Status(models.TextChoices):
        COMPETING = 'competing', 'Competing'
        ADVANCED = 'advanced', 'Advanced'
        ELIMINATED = 'eliminated', 'Eliminated'
        PLACED = 'placed', 'Placed (final round)'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    round = models.ForeignKey(ContestRound, on_delete=models.CASCADE, related_name='entries')
    contestant = models.ForeignKey(Candidate, on_delete=models.CASCADE, related_name='round_entries')
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.COMPETING)
    rank = models.PositiveIntegerField(null=True, blank=True)
    score = models.FloatField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['round__order', 'rank']
        constraints = [models.UniqueConstraint(fields=['round', 'contestant'], name='round_entry_unique')]


class ContestCategory(models.Model):
    """Sub-award inside a contest (Miss Photogenic, People's Choice…) with its own rules and result."""

    class Selection(models.TextChoices):
        PUBLIC_VOTE = 'public_vote', 'Public vote'
        JUDGES = 'judges', 'Judges\' scores'
        MANUAL = 'manual', 'Organizer picks'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='categories')
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=80, blank=True)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)
    selection = models.CharField(max_length=12, choices=Selection.choices, default=Selection.PUBLIC_VOTE)
    nominees = models.ManyToManyField(Candidate, blank=True, related_name='categories', help_text='Empty = every active contestant')
    votes_per_voter = models.PositiveIntegerField(null=True, blank=True, help_text='Blank = contest setting')
    votes_per_day = models.PositiveIntegerField(null=True, blank=True, help_text='Blank = contest setting')
    results_visibility = models.CharField(max_length=20, choices=Poll.ResultsVisibility.choices, blank=True)
    round = models.ForeignKey(ContestRound, null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
                              help_text='Judges selection: round whose scores decide')
    criterion = models.ForeignKey(Criterion, null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
                                  help_text='Judges selection: decide on this criterion only')
    winner = models.ForeignKey(Candidate, null=True, blank=True, on_delete=models.SET_NULL, related_name='category_wins')

    class Meta:
        ordering = ['order', 'name']
        verbose_name_plural = 'contest categories'

    def __str__(self):
        return self.name


class ContestJudge(models.Model):
    """A user account assigned to judge one contest (any role; new judges get an attendee account)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='judges')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='judging')
    name = models.CharField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True)
    excluded_contestants = models.ManyToManyField(Candidate, blank=True, related_name='excluded_judges',
                                                  help_text='Conflict of interest: this judge does not score them')
    invited_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['invited_at']
        constraints = [models.UniqueConstraint(fields=['poll', 'user'], name='judge_unique_per_contest')]

    @property
    def display_name(self):
        return self.name or self.user.get_full_name() or self.user.email


class ScoreSheet(models.Model):
    """One judge's scores for one contestant in one round. Locked once submitted until the organizer unlocks it."""

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        SUBMITTED = 'submitted', 'Submitted'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    round = models.ForeignKey(ContestRound, on_delete=models.CASCADE, related_name='score_sheets')
    judge = models.ForeignKey(ContestJudge, on_delete=models.CASCADE, related_name='sheets')
    contestant = models.ForeignKey(Candidate, on_delete=models.CASCADE, related_name='score_sheets')
    scores = models.JSONField(default=dict, blank=True, help_text='{criterion_id: points}')
    comment = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    submitted_at = models.DateTimeField(null=True, blank=True)
    unlocked_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['round', 'judge', 'contestant'], name='score_sheet_unique')]


def hash_voter(raw: str) -> str:
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def keyed_hash(raw: str) -> str:
    """HMAC for values that are easy to brute-force from a plain hash (IP addresses, phone numbers)."""
    return hmac.new(settings.SECRET_KEY.encode(), raw.encode('utf-8'), hashlib.sha256).hexdigest()


class Vote(models.Model):
    class Source(models.TextChoices):
        FREE = 'free', 'Free'
        PAID = 'paid', 'Paid'
        BONUS = 'bonus', 'Bonus'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='votes')
    candidate = models.ForeignKey(Candidate, on_delete=models.CASCADE, related_name='votes')
    ticket = models.ForeignKey('events.EventTicket', null=True, blank=True, on_delete=models.SET_NULL, related_name='poll_votes')
    voter_identifier = models.CharField(max_length=64, db_index=True, help_text='SHA-256 of the voter key; never the raw phone/email')
    voted_at = models.DateTimeField(default=timezone.now, db_index=True)
    # Contest fields
    round = models.ForeignKey(ContestRound, null=True, blank=True, on_delete=models.SET_NULL, related_name='votes')
    category = models.ForeignKey(ContestCategory, null=True, blank=True, on_delete=models.CASCADE, related_name='votes')
    quantity = models.PositiveIntegerField(default=1)
    source = models.CharField(max_length=6, choices=Source.choices, default=Source.FREE)
    method = models.CharField(max_length=10, blank=True, help_text='Verification method used (vote mode)')
    nepal_date = models.DateField(null=True, blank=True, db_index=True)
    ip_hash = models.CharField(max_length=64, blank=True, db_index=True)
    subnet_hash = models.CharField(max_length=64, blank=True)
    device_hash = models.CharField(max_length=64, blank=True, db_index=True)
    flags = models.JSONField(default=list, blank=True)
    is_void = models.BooleanField(default=False)
    void_reason = models.CharField(max_length=255, blank=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    # Quick polls: "<voter>:<candidate>" so one voter can't pick the same option twice (null for contests)
    unique_key = models.CharField(max_length=110, null=True, blank=True)
    # Paid votes: the payment(s) the spent credits came from (payments.PaymentIntent ids, oldest credit first)
    payment_ref = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ['voted_at']
        constraints = [
            models.UniqueConstraint(fields=['poll', 'unique_key'], name='vote_unique_key_per_poll'),
        ]

    def save(self, *args, **kwargs):
        if self.nepal_date is None:
            self.nepal_date = nepal_date(self.voted_at)
        super().save(*args, **kwargs)


class VotePack(models.Model):
    """Paid vote pack offered on a contest (e.g. 50 votes + 5 bonus for Rs 450). Sold via apps.payments (later)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='vote_packs')
    label = models.CharField(max_length=80, blank=True)
    votes = models.PositiveIntegerField()
    bonus_votes = models.PositiveIntegerField(default=0)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'votes']


class VoteCredit(models.Model):
    """Ledger of extra vote credits per voter: +amount when granted (paid/bonus), -amount when spent.

    Balance = sum(amount). Free allowance is not in the ledger (it is computed from Vote rows).
    Payments wiring: call apps.voting.credits.grant_credits(...) once a payment for a VotePack succeeds.
    """

    class Source(models.TextChoices):
        FREE = 'free', 'Free'
        PAID = 'paid', 'Paid'
        BONUS = 'bonus', 'Bonus'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='credits')
    voter_identifier = models.CharField(max_length=64, db_index=True)
    source = models.CharField(max_length=6, choices=Source.choices)
    amount = models.IntegerField(help_text='+ granted, - spent')
    pack = models.ForeignKey(VotePack, null=True, blank=True, on_delete=models.SET_NULL, related_name='credits')
    # Reference to the payment that paid for it (apps.payments row id / gateway reference); unique per poll so a
    # payment callback that arrives twice can't credit twice.
    payment_ref = models.CharField(max_length=100, null=True, blank=True)
    vote = models.ForeignKey(Vote, null=True, blank=True, on_delete=models.SET_NULL, related_name='credit_entries')
    # Debits (amount < 0) point at the grant they used up, so each payment's unspent credits are known exactly
    grant = models.ForeignKey('self', null=True, blank=True, on_delete=models.CASCADE, related_name='debits')
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        constraints = [
            models.UniqueConstraint(fields=['poll', 'payment_ref', 'source'], condition=Q(payment_ref__isnull=False),
                                    name='vote_credit_payment_once'),
        ]


class VotePurchase(models.Model):
    """One checkout for paid votes (a pack, or N votes at the per-vote price). Paid through apps.payments
    (purpose 'vote_pack', PaymentIntent.reference = this id); credits are granted to `voter_identifier` once paid."""

    class Status(models.TextChoices):
        PENDING = 'pending', 'Awaiting payment'
        PAID = 'paid', 'Paid'
        FAILED = 'failed', 'Not paid'
        REFUNDED = 'refunded', 'Refunded'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='purchases')
    pack = models.ForeignKey(VotePack, null=True, blank=True, on_delete=models.SET_NULL, related_name='purchases')
    voter_identifier = models.CharField(max_length=64, db_index=True)
    method = models.CharField(max_length=10, blank=True, help_text='How the buyer was verified (vote mode)')
    label = models.CharField(max_length=120, blank=True)
    votes = models.PositiveIntegerField()
    bonus_votes = models.PositiveIntegerField(default=0)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    intent = models.OneToOneField('payments.PaymentIntent', null=True, blank=True, on_delete=models.SET_NULL, related_name='vote_purchase')
    contestant = models.ForeignKey(Candidate, null=True, blank=True, on_delete=models.SET_NULL, related_name='purchases',
                                   help_text='Bought from this contestant\'s page (revenue attribution, buy-and-vote target)')
    auto_vote = models.BooleanField(default=False)
    auto_voted = models.PositiveIntegerField(default=0)
    auto_vote_note = models.CharField(max_length=255, blank=True)
    nepal_date = models.DateField(db_index=True)
    ip_hash = models.CharField(max_length=64, blank=True)
    device_hash = models.CharField(max_length=64, blank=True)
    flags = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    refunded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    @property
    def total_votes(self):
        return self.votes + self.bonus_votes


class VoteOTP(models.Model):
    """One-time code sent by SMS or email to verify a voter. Only keyed hashes are stored."""

    class Channel(models.TextChoices):
        SMS = 'sms', 'SMS'
        EMAIL = 'email', 'Email'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='otps')
    channel = models.CharField(max_length=5, choices=Channel.choices)
    destination_hash = models.CharField(max_length=64, db_index=True)
    code_hash = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    verified_at = models.DateTimeField(null=True, blank=True)
    ip_hash = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ['-created_at']


class ContestAuditLog(models.Model):
    """Organizer actions on a contest: advancement, voids, unlocks, reveals… (kept forever)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='audit_log')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    action = models.CharField(max_length=40)
    summary = models.CharField(max_length=500)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


def audit(poll, actor, action, summary, **detail):
    return ContestAuditLog.objects.create(
        poll=poll, actor=actor if getattr(actor, 'is_authenticated', False) else None,
        action=action, summary=summary[:500], detail=detail,
    )
