from rest_framework import serializers

from .models import MAX_TEXT, Review


def author_display_name(user):
    """Public name: "Asha S." — never the email (usernames are often the email)."""
    first, last = (user.first_name or '').strip(), (user.last_name or '').strip()
    if first:
        return f'{first} {last[0]}.' if last else first
    if user.username and '@' not in user.username:
        return user.username
    return 'Eventlaya user'


def target_data(review, request=None):
    if review.kind == Review.Kind.EVENT:
        e = review.event
        banner = e.banner.url if e.banner else None
        return {'id': str(e.id), 'name': e.title, 'slug': e.slug, 'image': banner}
    if review.kind == Review.Kind.VENDOR:
        v = review.vendor
        images = v.portfolio_images or []
        return {'id': str(v.id), 'name': v.business_name, 'slug': None, 'image': images[0] if images else None}
    v = review.venue
    images = v.images or []
    return {'id': str(v.id), 'name': v.name, 'slug': v.slug, 'image': images[0] if images else None}


class ReviewSerializer(serializers.ModelSerializer):
    """Read shape. Moderation fields are only filled for the author, the listing owner and admins (see view)."""
    author = serializers.SerializerMethodField()
    reply = serializers.SerializerMethodField()
    target = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = Review
        fields = ['id', 'kind', 'target', 'rating', 'text', 'author', 'reply', 'is_mine', 'edited_at',
                  'is_hidden', 'hidden_reason', 'created_at', 'updated_at']

    def get_author(self, obj):
        avatar = obj.author.avatar.url if obj.author.avatar else None
        return {'name': author_display_name(obj.author), 'avatar': avatar}

    def get_reply(self, obj):
        if not obj.reply_text:
            return None
        return {'text': obj.reply_text, 'replied_at': obj.replied_at}

    def get_target(self, obj):
        return target_data(obj)

    def get_is_mine(self, obj):
        user = getattr(self.context.get('request'), 'user', None)
        return bool(user and user.is_authenticated and obj.author_id == user.id)

    def to_representation(self, obj):
        data = super().to_representation(obj)
        if not self.context.get('moderation'):
            data.pop('hidden_reason')
        return data


class ReviewWriteSerializer(serializers.Serializer):
    rating = serializers.IntegerField(min_value=1, max_value=5)
    text = serializers.CharField(required=False, allow_blank=True, max_length=MAX_TEXT, default='', trim_whitespace=True)


class ReplySerializer(serializers.Serializer):
    text = serializers.CharField(max_length=MAX_TEXT, trim_whitespace=True)


class HideSerializer(serializers.Serializer):
    hidden = serializers.BooleanField(default=True)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=255, default='')
