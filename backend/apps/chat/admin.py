from django.contrib import admin

from .models import Conversation, ConversationMember, Message


class ConversationMemberInline(admin.TabularInline):
    model = ConversationMember
    extra = 0
    raw_id_fields = ('user', 'last_read_message')
    fields = ('user', 'role', 'muted', 'joined_at', 'left_at', 'last_read_at')


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'kind', 'owner', 'is_event_crew', 'event', 'last_message_at', 'created_at')
    list_filter = ('kind', 'is_event_crew')
    search_fields = ('title', 'owner__email')
    raw_id_fields = ('owner', 'event', 'created_by')
    readonly_fields = ('direct_key', 'last_message_at', 'created_at', 'updated_at')
    inlines = [ConversationMemberInline]


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    """Metadata only: message text and attachments are private to the chat's members."""
    list_display = ('id', 'conversation', 'sender', 'created_at', 'edited_at', 'deleted_at')
    list_filter = ('created_at',)
    search_fields = ('sender__email', 'conversation__title')
    raw_id_fields = ('conversation', 'sender', 'reply_to')
    fields = ('conversation', 'sender', 'reply_to', 'client_id', 'created_at', 'edited_at', 'deleted_at')
    readonly_fields = fields

    def has_add_permission(self, request):
        return False
