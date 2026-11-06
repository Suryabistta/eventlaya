from django.urls import path

from . import views

urlpatterns = [
    path('conversations/', views.ConversationListView.as_view(), name='chat_conversations'),
    path('conversations/<uuid:conv_id>/', views.ConversationDetailView.as_view(), name='chat_conversation'),
    path('conversations/<uuid:conv_id>/members/', views.MembersView.as_view(), name='chat_members'),
    path('conversations/<uuid:conv_id>/members/<uuid:user_id>/', views.MemberView.as_view(), name='chat_member'),
    path('conversations/<uuid:conv_id>/leave/', views.LeaveView.as_view(), name='chat_leave'),
    path('conversations/<uuid:conv_id>/mute/', views.MuteView.as_view(), name='chat_mute'),
    path('conversations/<uuid:conv_id>/read/', views.ReadView.as_view(), name='chat_read'),
    path('conversations/<uuid:conv_id>/messages/', views.MessageListView.as_view(), name='chat_messages'),
    path('messages/<uuid:message_id>/', views.MessageDetailView.as_view(), name='chat_message'),
    path('contacts/', views.ContactsView.as_view(), name='chat_contacts'),
    path('unread/', views.UnreadView.as_view(), name='chat_unread'),
]
