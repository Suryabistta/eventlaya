import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from .rendering import render_markdown

DEFAULT_AUTHOR = 'Eventlaya team'

# Cities of Koshi Province (Eastern Nepal) a post can target; the editor offers these, any other is allowed too.
KOSHI_CITIES = [
    'Biratnagar', 'Itahari', 'Dharan', 'Inaruwa', 'Damak', 'Birtamod', 'Mechinagar', 'Kakarbhitta', 'Bhadrapur',
    'Ilam', 'Dhankuta', 'Urlabari', 'Pathari', 'Belbari', 'Rangeli', 'Gaighat',
]


# Languages a post can be written in. English is the default; Nepali posts are usually translations of an English
# one (translation_of = the English post's slug) and are linked to it with hreflang.
LANGUAGES = [('en', 'English'), ('ne', 'नेपाली (Nepali)')]
LOCALES = {'en': 'en_US', 'ne': 'ne_NP'}


class PostQuerySet(models.QuerySet):
    def live(self, now=None):
        """Published, plus scheduled posts whose time has come."""
        now = now or timezone.now()
        return self.filter(
            Q(status=Post.Status.PUBLISHED) | Q(status=Post.Status.SCHEDULED),
            published_at__isnull=False, published_at__lte=now,
        )


class Post(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'
        SCHEDULED = 'scheduled', 'Scheduled'

    class Category(models.TextChoices):
        GUIDES = 'guides', 'Guides'
        CITY_GUIDES = 'city-guides', 'City guides'
        TICKETING = 'ticketing', 'Tickets & check-in'
        VENUES = 'venues', 'Venues & vendors'
        VOTING = 'voting', 'Voting & contests'
        PLANNING = 'planning', 'Planning'
        ABOUT = 'about', 'About Eventlaya'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=200, unique=True)
    excerpt = models.CharField(max_length=320, blank=True, help_text='Card text and meta description (aim for 140–160 characters)')
    body = models.TextField(blank=True, help_text='Markdown')
    cover_image = models.CharField(max_length=500, blank=True)
    cover_alt = models.CharField(max_length=200, blank=True)
    category = models.CharField(max_length=30, choices=Category.choices, default=Category.GUIDES, db_index=True)
    tags = models.JSONField(default=list, blank=True)
    cities = models.JSONField(default=list, blank=True, help_text='Target cities, e.g. ["Itahari", "Dharan"]')
    faq = models.JSONField(default=list, blank=True, help_text='[{"q": "...", "a": "..."}] shown as an FAQ and FAQPage data')
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT, db_index=True)
    published_at = models.DateTimeField(null=True, blank=True, db_index=True)
    author_name = models.CharField(max_length=120, default=DEFAULT_AUTHOR)
    language = models.CharField(max_length=5, choices=LANGUAGES, default='en', db_index=True)
    translation_of = models.SlugField(
        max_length=200, blank=True, db_index=True,
        help_text='Slug of the post this one translates (e.g. the English original); links the two with hreflang',
    )
    # SEO
    seo_title = models.CharField(max_length=120, blank=True, help_text='Overrides the <title> (aim for ≤ 60 characters)')
    canonical_url = models.URLField(max_length=500, blank=True, help_text='Only when the article first appeared elsewhere')
    noindex = models.BooleanField(default=False, help_text='Ask search engines not to index this post')
    focus_keyword = models.CharField(max_length=120, blank=True)
    # Rendered on save
    body_html = models.TextField(blank=True, editable=False)
    toc = models.JSONField(default=list, blank=True, editable=False)
    word_count = models.PositiveIntegerField(default=0, editable=False)
    reading_minutes = models.PositiveSmallIntegerField(default=1, editable=False)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name='blog_posts')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = PostQuerySet.as_manager()

    class Meta:
        ordering = ['-published_at', '-created_at']

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        rendered = render_markdown(self.body)
        self.body_html = rendered['html']
        self.toc = rendered['toc']
        self.word_count = rendered['word_count']
        self.reading_minutes = rendered['reading_minutes']
        if self.status == self.Status.PUBLISHED and not self.published_at:
            self.published_at = timezone.now()
        update_fields = kwargs.get('update_fields')
        if update_fields is not None:
            kwargs['update_fields'] = set(update_fields) | {'body_html', 'toc', 'word_count', 'reading_minutes',
                                                            'published_at', 'updated_at'}
        super().save(*args, **kwargs)

    @property
    def is_live(self):
        return (self.status in (self.Status.PUBLISHED, self.Status.SCHEDULED)
                and self.published_at is not None and self.published_at <= timezone.now())

    @property
    def path(self):
        return f'/blog/{self.slug}'

    @property
    def locale(self):
        return LOCALES.get(self.language, 'en_US')

    def translations(self):
        """Live posts that are the same article in another language (the original and its other translations),
        excluding this one. Each language appears once."""
        root = self.translation_of or self.slug
        posts = Post.objects.live().filter(Q(slug=root) | Q(translation_of=root)).exclude(pk=self.pk)
        seen, out = {self.language}, []
        # The original first, then the oldest translation per language.
        for p in sorted(posts, key=lambda p: (p.slug != root, p.published_at)):
            if p.language not in seen:
                seen.add(p.language)
                out.append(p)
        return out
