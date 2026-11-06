from django.utils import timezone
from django.utils.text import slugify
from rest_framework import serializers

from .models import Post


class PostCardSerializer(serializers.ModelSerializer):
    category_label = serializers.CharField(source='get_category_display', read_only=True)

    class Meta:
        model = Post
        fields = ['slug', 'title', 'excerpt', 'cover_image', 'cover_alt', 'category', 'category_label', 'tags',
                  'cities', 'author_name', 'published_at', 'updated_at', 'reading_minutes', 'language']


class PostDetailSerializer(PostCardSerializer):
    translations = serializers.SerializerMethodField()

    class Meta(PostCardSerializer.Meta):
        fields = PostCardSerializer.Meta.fields + ['body_html', 'toc', 'faq', 'word_count', 'seo_title', 'noindex',
                                                   'translation_of', 'translations']

    def get_translations(self, post):
        """The same article in other languages: [{language, slug, title}] (live posts only)."""
        return [{'language': p.language, 'slug': p.slug, 'title': p.title} for p in post.translations()]


def _clean_list(value, limit=20):
    if value in (None, ''):
        return []
    if not isinstance(value, list):
        raise serializers.ValidationError('Send a list.')
    out = []
    for item in value:
        text = str(item).strip()
        if text and text.lower() not in [o.lower() for o in out]:
            out.append(text[:60])
    return out[:limit]


class AdminPostSerializer(serializers.ModelSerializer):
    slug = serializers.SlugField(max_length=200, required=False, allow_blank=True)
    category_label = serializers.CharField(source='get_category_display', read_only=True)
    is_live = serializers.BooleanField(read_only=True)
    path = serializers.CharField(read_only=True)

    class Meta:
        model = Post
        fields = ['id', 'title', 'slug', 'excerpt', 'body', 'cover_image', 'cover_alt', 'category', 'category_label',
                  'tags', 'cities', 'faq', 'status', 'published_at', 'author_name', 'seo_title', 'canonical_url',
                  'noindex', 'focus_keyword', 'language', 'translation_of', 'body_html', 'toc', 'word_count', 'reading_minutes', 'is_live', 'path',
                  'created_at', 'updated_at']
        read_only_fields = ['body_html', 'toc', 'word_count', 'reading_minutes', 'created_at', 'updated_at']

    def validate_tags(self, value):
        return _clean_list(value, 12)

    def validate_cities(self, value):
        return _clean_list(value, 30)

    def validate_faq(self, value):
        if value in (None, ''):
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError('Send a list of questions and answers.')
        out = []
        for item in value:
            if not isinstance(item, dict):
                raise serializers.ValidationError('Each FAQ item needs a question and an answer.')
            q, a = str(item.get('q', '')).strip(), str(item.get('a', '')).strip()
            if q and a:
                out.append({'q': q[:300], 'a': a[:2000]})
            elif q or a:
                raise serializers.ValidationError('Each FAQ item needs both a question and an answer.')
        return out[:20]

    def validate_translation_of(self, value):
        value = slugify(value or '')[:200]
        if value and not Post.objects.filter(slug=value).exists():
            raise serializers.ValidationError('No post uses this address. Enter the slug of the original article.')
        return value

    def validate(self, attrs):
        instance = self.instance
        title = attrs.get('title', instance.title if instance else '')
        slug = attrs.get('slug')
        if not slug and not (instance and instance.slug):
            slug = slugify(title)[:200]
        if slug is not None:
            slug = slugify(slug)[:200]
            if not slug:
                raise serializers.ValidationError({'slug': 'Use letters, numbers and hyphens.'})
            clash = Post.objects.filter(slug=slug)
            if instance:
                clash = clash.exclude(pk=instance.pk)
            if clash.exists():
                raise serializers.ValidationError({'slug': 'Another post already uses this address.'})
            attrs['slug'] = slug
        own_slug = attrs.get('slug') or (instance.slug if instance else '')
        if attrs.get('translation_of') and attrs['translation_of'] == own_slug:
            raise serializers.ValidationError({'translation_of': 'A post can’t be a translation of itself.'})
        status = attrs.get('status', instance.status if instance else Post.Status.DRAFT)
        published_at = attrs.get('published_at', instance.published_at if instance else None)
        if status == Post.Status.SCHEDULED:
            if not published_at:
                raise serializers.ValidationError({'published_at': 'Pick the date and time to publish.'})
            if published_at <= timezone.now() and not (instance and instance.status == Post.Status.SCHEDULED):
                # Scheduling in the past just publishes it now.
                attrs['status'] = Post.Status.PUBLISHED
        if status == Post.Status.PUBLISHED and not (attrs.get('excerpt') or (instance and instance.excerpt)):
            raise serializers.ValidationError({'excerpt': 'Add a short description before publishing (search engines show it).'})
        return attrs
