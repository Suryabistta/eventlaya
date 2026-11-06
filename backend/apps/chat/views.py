"""REST API for team chat (/api/chat/). The chat module switch is enforced by ModuleAccessMiddleware."""
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .access import contacts
from .services import ChatError, conversation_detail, message_data, user_data


def _error(e):
    return Response({'error': e.message, 'code': e.code}, status=e.status)


class ChatView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def handle_exception(self, exc):
        if isinstance(exc, ChatError):
            return _error(exc)
        return super().handle_exception(exc)


class ConversationListView(ChatView):
    """GET my conversations; POST {kind: direct, user_id} (get-or-create) or {kind: group, title, user_ids}."""

    def get(self, request):
        return Response(services.conversations_for(request.user))

    def post(self, request):
        kind = request.data.get('kind') or ('direct' if request.data.get('user_id') else 'group')
        if kind == 'direct':
            conv, created = services.start_direct(request.user, request.data.get('user_id'))
        elif kind == 'group':
            ids = request.data.get('user_ids', request.data.get('member_ids'))
            conv, created = services.create_group(request.user, request.data.get('title'), ids), True
        else:
            raise ChatError('invalid', 'kind must be "direct" or "group".')
        return Response(conversation_detail(request.user, conv.id),
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class ConversationDetailView(ChatView):
    """GET detail (with members); PATCH {title} to rename a group (admins)."""

    def get(self, request, conv_id):
        return Response(conversation_detail(request.user, conv_id))

    def patch(self, request, conv_id):
        if 'title' in request.data:
            services.rename(request.user, conv_id, request.data.get('title'))
        if 'muted' in request.data:
            services.set_muted(request.user, conv_id, request.data.get('muted'))
        return Response(conversation_detail(request.user, conv_id))


class MembersView(ChatView):
    """POST {user_ids: [...]} to add people to a group (admins)."""

    def post(self, request, conv_id):
        services.add_members(request.user, conv_id, request.data.get('user_ids'))
        return Response(conversation_detail(request.user, conv_id))


class MemberView(ChatView):
    """PATCH {role: admin|member}; DELETE to remove someone from a group (admins)."""

    def patch(self, request, conv_id, user_id):
        services.set_member_role(request.user, conv_id, user_id, request.data.get('role'))
        return Response(conversation_detail(request.user, conv_id))

    def delete(self, request, conv_id, user_id):
        services.remove_member(request.user, conv_id, user_id)
        return Response(conversation_detail(request.user, conv_id))


class LeaveView(ChatView):
    def post(self, request, conv_id):
        services.leave(request.user, conv_id)
        return Response({'message': 'You left the group.', 'conversation_id': str(conv_id)})


class MuteView(ChatView):
    """POST {muted: true|false} (default true)."""

    def post(self, request, conv_id):
        services.set_muted(request.user, conv_id, request.data.get('muted', True))
        return Response(conversation_detail(request.user, conv_id))


class ReadView(ChatView):
    """POST {message_id?}: mark read up to that message (default: the latest)."""

    def post(self, request, conv_id):
        return Response(services.mark_read(request.user, conv_id, request.data.get('message_id')))


class MessageListView(ChatView):
    """GET ?before=&after=&limit=; POST {body, attachment?, reply_to?, client_id?}."""

    def get(self, request, conv_id):
        q = request.query_params
        return Response(services.list_messages(request.user, conv_id, q.get('before'), q.get('after'), q.get('limit')))

    def post(self, request, conv_id):
        d = request.data
        msg, created = services.send_message(
            request.user, conv_id, body=d.get('body'), attachment=d.get('attachment'),
            reply_to=d.get('reply_to') or d.get('reply_to_id'), client_id=d.get('client_id'),
        )
        return Response(message_data(msg), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class MessageDetailView(ChatView):
    """PATCH {body} to edit (sender, within 15 minutes); DELETE (sender, or a group admin)."""

    def patch(self, request, message_id):
        return Response(message_data(services.edit_message(request.user, message_id, request.data.get('body'))))

    def delete(self, request, message_id):
        return Response(message_data(services.delete_message(request.user, message_id)))


class ContactsView(ChatView):
    def get(self, request):
        return Response([user_data(u) for u in contacts(request.user)])


class UnreadView(ChatView):
    def get(self, request):
        return Response(services.unread_summary(request.user))
