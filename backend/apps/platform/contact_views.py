"""Home page contact form.

POST  /api/platform/contact/                anyone: {name, email, phone?, role, message}
GET   /api/platform/contact/messages/       superadmin: latest messages
PATCH /api/platform/contact/messages/<id>/  superadmin: {handled}
"""
from datetime import timedelta

from django.core.mail import mail_admins
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ContactMessage
from .views import IsSuperadmin

PER_IP_PER_HOUR = 5


def _dict(m):
    return {'id': str(m.id), 'name': m.name, 'email': m.email, 'phone': m.phone, 'role': m.role, 'role_display': m.get_role_display(),
            'message': m.message, 'handled': m.handled, 'created_at': m.created_at}


class ContactView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        d = request.data
        name, email = (d.get('name') or '').strip()[:120], (d.get('email') or '').strip()[:254]
        message = (d.get('message') or '').strip()[:3000]
        if not name or not message:
            return Response({'error': 'Add your name and a message.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_email(email)
        except ValidationError:
            return Response({'error': 'Enter a valid email so we can reply.'}, status=status.HTTP_400_BAD_REQUEST)
        ip = request.META.get('HTTP_X_REAL_IP') or request.META.get('REMOTE_ADDR')
        if ContactMessage.objects.filter(ip=ip, created_at__gte=timezone.now() - timedelta(hours=1)).count() >= PER_IP_PER_HOUR:
            return Response({'error': 'You’ve sent several messages already. We’ll reply soon.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        role = d.get('role') if d.get('role') in ContactMessage.Role.values else ContactMessage.Role.USER
        m = ContactMessage.objects.create(name=name, email=email, phone=(d.get('phone') or '').strip()[:30], role=role, message=message, ip=ip)
        mail_admins(f'Contact: {name} ({m.get_role_display()})', f'{message}\n\n{email} {m.phone}', fail_silently=True)
        return Response({'ok': True}, status=status.HTTP_201_CREATED)


class ContactMessageListView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        return Response([_dict(m) for m in ContactMessage.objects.all()[:200]])


class ContactMessageDetailView(APIView):
    permission_classes = [IsSuperadmin]

    def patch(self, request, pk):
        m = get_object_or_404(ContactMessage, pk=pk)
        m.handled = bool(request.data.get('handled'))
        m.save(update_fields=['handled'])
        return Response(_dict(m))
