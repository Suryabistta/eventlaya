"""Attach guest data (tickets, marketplace inquiries) to an account once its email address is proven."""
from django.utils import timezone


def attach_guest_records(user):
    """Link unowned tickets and inquiries made with the user's (verified) email. Returns the ticket count."""
    if not user.email_verified or not user.email:
        return 0
    from apps.events.models import EventTicket
    from apps.marketplace.models import VendorInquiry, VenueInquiry

    tickets = EventTicket.objects.filter(user__isnull=True, attendee_email__iexact=user.email).update(user=user)
    VenueInquiry.objects.filter(user__isnull=True, sender_email__iexact=user.email).update(user=user)
    VendorInquiry.objects.filter(user__isnull=True, sender_email__iexact=user.email).update(user=user)
    return tickets


def mark_email_verified(user):
    """Mark the address verified (idempotent) and attach guest records. Returns the number of tickets linked."""
    if not user.email_verified:
        user.email_verified = True
        user.email_verified_at = timezone.now()
        user.save(update_fields=['email_verified', 'email_verified_at', 'updated_at'])
    return attach_guest_records(user)
