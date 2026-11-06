from django.contrib import admin

from .models import Post


@admin.register(Post)
class PostAdmin(admin.ModelAdmin):
    list_display = ('title', 'language', 'status', 'category', 'published_at', 'updated_at')
    list_filter = ('status', 'language', 'category')
    search_fields = ('title', 'slug', 'excerpt')
    prepopulated_fields = {'slug': ('title',)}
