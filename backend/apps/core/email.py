import logging
from django.core.mail import send_mail
from django.conf import settings
from django.utils.html import escape

logger = logging.getLogger(__name__)


def site_url(event):
    """Base URL for links about an event: the organizer's live white-label site, else FRONTEND_URL."""
    from apps.accounts.tenancy import site_url_for_organizer
    return (site_url_for_organizer(event.organizer) if event is not None else '') or \
        getattr(settings, 'FRONTEND_URL', 'https://eventlaya.com').rstrip('/')


def pass_url(ticket):
    """Public page that shows one pass (the QR token in the link is what grants access)."""
    return f"{site_url(ticket.event)}/ticket/{ticket.qr_token}"


def event_url(event):
    return f"{site_url(event)}/e/{event.slug}"


def email_brand(event):
    """(brand name, show "Powered by Eventlaya") for an event's emails."""
    from apps.accounts.tenancy import live_branding_for_organizer
    branding = live_branding_for_organizer(event.organizer)
    if branding is None:
        return 'Eventlaya', True
    return (branding.brand_name or event.organizer.organization_name or 'Eventlaya'), not branding.remove_watermark


def from_email(event):
    """'Dharan Film Festival via Eventlaya <passes@eventlaya.com>' for white-label events (same mailbox)."""
    from email.utils import formataddr, parseaddr
    default = getattr(settings, 'DEFAULT_FROM_EMAIL', 'passes@eventlaya.com')
    brand, _ = email_brand(event)
    if brand == 'Eventlaya':
        return default
    _name, address = parseaddr(default)
    return formataddr((f'{brand} via Eventlaya', address or 'passes@eventlaya.com'))

def payment_receipt(order):
    """[(label, value)] for the payment part of an order email: amount, how it was paid, reference."""
    if order is None:
        return []
    amount = f'Rs {order.total:,.2f}'
    if order.payment_status == 'free':
        return [('Total', 'Free')]
    if order.payment_status == 'due':
        return [('Total', f'{amount} to pay at the venue')]
    if order.payment_status == 'paid' and order.paid_via != 'venue':
        provider = {'khalti': 'Khalti', 'esewa': 'eSewa', 'test': 'Test payment'}.get(order.paid_via, order.paid_via)
        rows = [('Paid', f'{amount} online with {provider}')]
        if order.payment_reference:
            rows.append(('Payment reference', order.payment_reference))
        if order.paid_at:
            from django.utils import timezone
            rows.append(('Paid on', timezone.localtime(order.paid_at).strftime('%d %b %Y, %I:%M %p')))
        rows.append(('Receipt', f'Order {order.reference}'))
        return rows
    return [('Total', order.payment_label)]


def _receipt_text(rows):
    return ''.join(f"• {label:<13}: {value}\n" for label, value in rows)


def _receipt_html(rows):
    return ''.join(
        f'<tr><td style="padding: 8px 0; color: #64748b; border-bottom: 1px solid #f1f5f9;">{escape(label)}</td>'
        f'<td style="padding: 8px 0; color: #1e293b; font-weight: 600; text-align: right; border-bottom: 1px solid #f1f5f9;">{escape(value)}</td></tr>'
        for label, value in rows
    )


def send_ticket_email(ticket, event, order=None):
    """
    Sends an automated email confirmation with the attendee's digital ticket
    number, QR pass link, and entry instructions (plus the payment receipt when there's an order).
    """
    receipt = payment_receipt(order if order is not None else (ticket.order if ticket.order_id else None))
    subject = f"🎟️ Your Digital Ticket Pass: {event.title}"
    recipient = ticket.attendee_email
    brand, powered = email_brand(event)
    signature = 'Organized via Eventlaya Platform\nEastern Nepal Hub • Dharan • Itahari • Biratnagar' if brand == 'Eventlaya' else (
        f'{brand}' + ('\nPowered by Eventlaya' if powered else ''))
    footer_html = (
        'Powered by Eventlaya — Event Management SaaS & Services Marketplace for Eastern Nepal (Dharan • Itahari • Biratnagar)'
        if brand == 'Eventlaya' else (f'{escape(brand)}' + (' · Powered by Eventlaya' if powered else ''))
    )
    badge = 'Verified Eventlaya Pass' if brand == 'Eventlaya' else f'{escape(brand)} pass'

    text_content = f"""Namaste {ticket.attendee_name},

Your registration for '{event.title}' is confirmed!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TICKET DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Ticket Number : {ticket.ticket_number}
• Attendee      : {ticket.attendee_name}
• Event         : {event.title}
• Date & Time   : {event.start_date} {event.start_time or ''}
• Location      : {event.location}
• Status        : Verified & Active
{_receipt_text(receipt)}
GATE CHECK-IN INSTRUCTIONS:
Please show your digital QR pass at the entrance terminal upon arrival for instant check-in.
You can view and save your official QR ticket pass here:
{pass_url(ticket)}

Event page: {event_url(event)}

{signature}
"""

    html_content = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0;">
        <div style="background: linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%); padding: 32px 24px; text-align: center; color: #ffffff;">
            <span style="background: rgba(255, 255, 255, 0.2); padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; margin-bottom: 12px;">{badge}</span>
            <h1 style="margin: 0; font-size: 24px; font-weight: 800; line-height: 1.3;">{event.title}</h1>
            <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.9;">Registration Confirmed</p>
        </div>
        
        <div style="padding: 24px;">
            <p style="font-size: 14px; color: #334155; margin-top: 0;">Namaste <strong>{ticket.attendee_name}</strong>,</p>
            <p style="font-size: 14px; color: #64748b; line-height: 1.6;">Your seat has been reserved. Please keep your digital ticket pass ready at the gate checkpoint.</p>
            
            <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
                <span style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; display: block;">Serial Ticket Code</span>
                <span style="font-size: 20px; font-family: monospace; font-weight: 800; color: #1e293b; display: block; margin: 6px 0;">{ticket.ticket_number}</span>
                <span style="font-size: 12px; color: #10b981; font-weight: 600;">● Active Entry Pass</span>
            </div>

            <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px;">
                <tr>
                    <td style="padding: 8px 0; color: #64748b; border-bottom: 1px solid #f1f5f9;">Date & Time</td>
                    <td style="padding: 8px 0; color: #1e293b; font-weight: 600; text-align: right; border-bottom: 1px solid #f1f5f9;">{event.start_date} {event.start_time or ''}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #64748b; border-bottom: 1px solid #f1f5f9;">Location</td>
                    <td style="padding: 8px 0; color: #1e293b; font-weight: 600; text-align: right; border-bottom: 1px solid #f1f5f9;">{event.location}</td>
                </tr>
                {_receipt_html(receipt)}
                <tr>
                    <td style="padding: 8px 0; color: #64748b;">Attendee Email</td>
                    <td style="padding: 8px 0; color: #1e293b; font-weight: 600; text-align: right;">{ticket.attendee_email}</td>
                </tr>
            </table>

            <div style="text-align: center; margin: 28px 0 16px;">
                <a href="{pass_url(ticket)}" style="background: #4F46E5; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 12px; font-size: 14px; font-weight: 700; display: inline-block;">View Digital QR Pass</a>
            </div>
            
            <p style="font-size: 11px; color: #94a3b8; text-align: center; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 16px;">
                {footer_html}
            </p>
        </div>
    </div>
    """

    try:
        send_mail(
            subject=subject,
            message=text_content,
            from_email=from_email(event),
            recipient_list=[recipient],
            html_message=html_content,
            fail_silently=True,
        )
        logger.info(f"Ticket email dispatched to {recipient} for {ticket.ticket_number}")
        return True
    except Exception as e:
        logger.warning(f"Failed to send ticket email to {recipient}: {e}")
        return False


def send_order_email(order, tickets, event):
    """One email to the buyer with every pass in the order (single tickets use the regular ticket email)."""
    if len(tickets) == 1:
        return send_ticket_email(tickets[0], event, order)
    when = f"{event.start_date} {event.start_time or ''}".strip()
    brand, powered = email_brand(event)
    signature = 'Organized via Eventlaya' if brand == 'Eventlaya' else (brand + ('\nPowered by Eventlaya' if powered else ''))
    receipt = payment_receipt(order)
    total = order.payment_label
    lines = '\n'.join(
        f"• {t.attendee_name} — {t.ticket_type_name or 'Ticket'} — {t.ticket_number}\n  {pass_url(t)}" for t in tickets
    )
    text = f"""Namaste {order.buyer_name},

Your {len(tickets)} passes for '{event.title}' are ready (order {order.reference}).

• Event    : {event.title}
• When     : {when}
• Where    : {event.location}
{_receipt_text(receipt)}
PASSES — each person shows their own QR code at the gate:
{lines}

Forward each guest the link to their pass, or show them from your phone.

Event page: {event_url(event)}

{signature}
"""
    rows = ''.join(
        f'<tr><td style="padding:10px 0;border-top:1px solid #eee;"><strong>{t.attendee_name}</strong><br>'
        f'<span style="color:#64748b;font-size:13px;">{t.ticket_type_name or "Ticket"} · {t.ticket_number}</span></td>'
        f'<td style="padding:10px 0;border-top:1px solid #eee;text-align:right;">'
        f'<a href="{pass_url(t)}" style="background:#C2215A;color:#fff;text-decoration:none;padding:8px 14px;'
        f'border-radius:10px;font-size:13px;font-weight:700;">View pass</a></td></tr>'
        for t in tickets
    )
    html = f"""<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1C1724;">
<h2 style="margin:0 0 4px;">Your {len(tickets)} passes are ready</h2>
<p style="color:#64748b;margin:0 0 16px;">{event.title} · {when} · {event.location}</p>
<p style="margin:0 0 16px;">Order <strong>{order.reference}</strong> · {total}</p>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px;">{_receipt_html(receipt)}</table>
<table style="width:100%;border-collapse:collapse;">{rows}</table>
<p style="color:#64748b;font-size:13px;margin-top:16px;">Each person shows their own QR code at the gate. Forward each guest the link to their pass.</p>
<p style="color:#94a3b8;font-size:12px;margin-top:16px;"><a href="{event_url(event)}" style="color:#64748b;">Event page</a> · {escape(signature).replace(chr(10), ' · ')}</p>
</div>"""
    try:
        send_mail(
            subject=f"🎟️ Your {len(tickets)} passes: {event.title}",
            message=text,
            from_email=from_email(event),
            recipient_list=[order.buyer_email],
            html_message=html,
            fail_silently=True,
        )
        logger.info(f"Order email dispatched to {order.buyer_email} for {order.reference}")
        return True
    except Exception as e:
        logger.warning(f"Failed to send order email to {order.buyer_email}: {e}")
        return False
