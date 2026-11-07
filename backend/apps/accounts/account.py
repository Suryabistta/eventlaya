"""Self-service account management: change password and delete the account (required by the app stores)."""
from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError
from django.db import transaction
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

SUPPORT_EMAIL = 'support@eventlaya.com'


class ChangePasswordView(APIView):
    """POST {current_password, new_password}.

    Accounts created through Google/Facebook have no password yet (has_password=false): they can set one
    without current_password.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        new_password = request.data.get('new_password') or ''
        if user.has_usable_password() and not user.check_password(request.data.get('current_password') or ''):
            return Response({'error': 'Your current password is incorrect.', 'code': 'wrong_password'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            password_validation.validate_password(new_password, user)
        except ValidationError as e:
            return Response({'error': ' '.join(e.messages), 'new_password': e.messages}, status=status.HTTP_400_BAD_REQUEST)
        had_password = user.has_usable_password()
        user.set_password(new_password)
        user.must_change_password = False
        user.save(update_fields=['password', 'must_change_password', 'updated_at'])
        return Response({'message': 'Password changed.' if had_password else 'Password set.', 'has_password': True})


def deletion_blocker(user):
    """(code, message) when deleting this account would destroy other people's data, else None.

    Events, listings and billing records cascade with their owner, so owners of anything other people
    depend on are sent to support instead of deleting in-app.
    """
    from apps.events.models import EventTicket
    from apps.marketplace.models import VendorInquiry, VenueInquiry

    if user.is_superadmin or user.is_staff or user.is_superuser:
        return 'admin_account', 'Platform admin accounts can’t be deleted from the app. Ask another admin.'
    if EventTicket.objects.filter(event__organizer=user).exists():
        return ('organizer_has_registrations',
                f'You organize events that people have registered for, so this account can’t be deleted '
                f'in the app. Contact {SUPPORT_EMAIL} and we’ll help close it without losing attendee records.')
    if (VenueInquiry.objects.filter(venue__owner=user).exists()
            or VendorInquiry.objects.filter(vendor__user=user).exists()):
        return ('listings_have_inquiries',
                f'Your marketplace listings have customer inquiries, so this account can’t be deleted in the '
                f'app. Contact {SUPPORT_EMAIL} to close it.')
    if user.payments.exists():
        return ('billing_history',
                f'This account has billing history that we must keep. Contact {SUPPORT_EMAIL} to close it.')
    return None


def delete_account(user):
    """Delete the user. Tickets and inquiries they made stay with the organizer/vendor (their user link is
    cleared by on_delete=SET_NULL); their reviews, social links, codes and push tokens are removed."""
    with transaction.atomic():
        user.tickets.update(user=None)  # explicit, so it doesn't depend on the FK default
        user.delete()


def check_deletion_confirmation(user, data):
    """Password accounts confirm with their password; social-only accounts send {"confirm": true}."""
    if user.has_usable_password():
        if not user.check_password(data.get('password') or ''):
            return Response({'error': 'Enter your current password to delete your account.', 'code': 'wrong_password'},
                            status=status.HTTP_400_BAD_REQUEST)
    elif data.get('confirm') is not True:
        return Response({'error': 'Send {"confirm": true} to delete your account.', 'code': 'confirmation_required'},
                        status=status.HTTP_400_BAD_REQUEST)
    return None
