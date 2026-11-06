from django.contrib import admin

from .models import Review


@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = ('kind', 'target', 'author', 'rating', 'is_hidden', 'replied_at', 'created_at')
    list_filter = ('kind', 'is_hidden', 'rating')
    search_fields = ('author__email', 'text', 'event__title', 'vendor__business_name', 'venue__name')
    raw_id_fields = ('author', 'event', 'vendor', 'venue', 'hidden_by', 'reply_by')
