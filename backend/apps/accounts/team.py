import secrets

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

User = get_user_model()

# Avoids look-alike characters so a temporary password is easy to read out or type.
_PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'


def temporary_password(length=10):
    return ''.join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(length))


def unique_username(email):
    base = email.split('@')[0][:140] or 'staff'
    username, i = base, 1
    while User.objects.filter(username=username).exists():
        i += 1
        username = f'{base}{i}'
    return username


def create_staff_account(email, owner, first_name='', last_name='', phone='', password=None):
    """New gate staff account on [owner]'s team. Returns (user, temporary_password or None)."""
    temp = None
    if not password:
        password = temp = temporary_password()
    user = User.objects.create_user(
        username=unique_username(email), email=email, password=password, role=User.Role.STAFF,
        first_name=first_name, last_name=last_name, phone=phone, team_owner=owner,
    )
    return user, temp


def _can_manage_team(user):
    return user.role == User.Role.ORGANIZER or user.is_superadmin


def team_queryset(owner):
    """Staff on the organizer's team, plus anyone assigned to one of their events."""
    from apps.events.models import StaffGateAssignment
    assigned = StaffGateAssignment.objects.filter(event__organizer=owner).values('staff_id')
    return (
        User.objects.filter(role=User.Role.STAFF)
        .filter(Q(team_owner=owner) | Q(id__in=assigned))
        .distinct()
        .order_by('-is_active', 'first_name', 'email')
    )


def member_data(user, owner):
    from apps.events.models import StaffGateAssignment
    assignments = (
        StaffGateAssignment.objects.filter(staff=user, event__organizer=owner)
        .select_related('event', 'gate')
        .order_by('event__start_date')
    )
    return {
        'id': str(user.id),
        'name': user.get_full_name() or user.username,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'email': user.email,
        'phone': user.phone,
        'is_active': user.is_active,
        'date_joined': user.date_joined.isoformat(),
        'last_login': user.last_login.isoformat() if user.last_login else None,
        'assignments': [
            {
                'id': str(a.id),
                'event_id': str(a.event_id),
                'event_title': a.event.title,
                'gate_id': str(a.gate_id) if a.gate_id else None,
                'gate_name': a.gate.name if a.gate_id else a.gate_name,
                'is_active': a.is_active,
            }
            for a in assignments
        ],
    }


class TeamListView(APIView):
    """Organizer: list their gate staff team, or onboard a new member."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not _can_manage_team(request.user):
            return Response({'error': 'Only organizers can manage a team.'}, status=status.HTTP_403_FORBIDDEN)
        return Response([member_data(u, request.user) for u in team_queryset(request.user)])

    def post(self, request):
        if not _can_manage_team(request.user):
            return Response({'error': 'Only organizers can manage a team.'}, status=status.HTTP_403_FORBIDDEN)

        email = (request.data.get('email') or '').strip().lower()
        if not email or '@' not in email:
            return Response({'error': 'Enter a valid email address.'}, status=status.HTTP_400_BAD_REQUEST)
        first_name = (request.data.get('first_name') or '').strip()[:150]
        last_name = (request.data.get('last_name') or '').strip()[:150]
        phone = (request.data.get('phone') or '').strip()[:20]
        password = request.data.get('password') or ''
        if password and len(password) < 8:
            return Response({'error': 'Password must be at least 8 characters.'}, status=status.HTTP_400_BAD_REQUEST)

        existing = User.objects.filter(email__iexact=email).first()
        if existing:
            if existing.role != User.Role.STAFF:
                return Response(
                    {'error': f'{email} is a {existing.get_role_display().lower()} account. Use a different email for staff.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if existing.team_owner_id and existing.team_owner_id != request.user.id:
                return Response({'error': f"{email} is already on another organizer's team."}, status=status.HTTP_400_BAD_REQUEST)
            if existing.team_owner_id == request.user.id:
                return Response({'error': f'{email} is already on your team.'}, status=status.HTTP_400_BAD_REQUEST)
            existing.team_owner = request.user
            existing.save(update_fields=['team_owner'])
            data = member_data(existing, request.user)
            data.update({'message': f'{email} added to your team', 'temporary_password': None, 'created': False})
            return Response(data, status=status.HTTP_200_OK)

        with transaction.atomic():
            user, temp = create_staff_account(
                email, request.user, first_name=first_name, last_name=last_name, phone=phone, password=password or None,
            )
        data = member_data(user, request.user)
        data.update({'message': f'{email} added to your team', 'temporary_password': temp, 'created': True})
        return Response(data, status=status.HTTP_201_CREATED)


class TeamMemberView(APIView):
    """Organizer: edit, deactivate/reactivate, reset the password of, or remove a team member."""
    permission_classes = [permissions.IsAuthenticated]

    def _member(self, request, member_id):
        if not _can_manage_team(request.user):
            return None, Response({'error': 'Only organizers can manage a team.'}, status=status.HTTP_403_FORBIDDEN)
        return get_object_or_404(team_queryset(request.user), id=member_id), None

    def patch(self, request, member_id):
        member, err = self._member(request, member_id)
        if err:
            return err
        fields = []
        for f, limit in (('first_name', 150), ('last_name', 150), ('phone', 20)):
            if f in request.data:
                setattr(member, f, (request.data.get(f) or '').strip()[:limit])
                fields.append(f)
        if 'is_active' in request.data:
            member.is_active = bool(request.data.get('is_active'))
            fields.append('is_active')
        temp = None
        if request.data.get('reset_password'):
            temp = temporary_password()
            member.set_password(temp)
            fields.append('password')
        if fields:
            member.save(update_fields=fields)
        data = member_data(member, request.user)
        data['temporary_password'] = temp
        return Response(data)

    def delete(self, request, member_id):
        from apps.events.models import StaffGateAssignment
        member, err = self._member(request, member_id)
        if err:
            return err
        with transaction.atomic():
            StaffGateAssignment.objects.filter(staff=member, event__organizer=request.user).delete()
            if member.team_owner_id == request.user.id:
                member.team_owner = None
            # Nobody else relies on this account any more, so stop it signing in.
            if not member.team_owner_id and not StaffGateAssignment.objects.filter(staff=member).exists():
                member.is_active = False
            member.save(update_fields=['team_owner', 'is_active'])
        return Response({'message': f'{member.email} removed from your team'})
