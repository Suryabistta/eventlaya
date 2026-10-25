import logging
from django.core.mail import send_mail
from django.conf import settings

logger = logging.getLogger(__name__)

def send_ticket_email(ticket, event):
    """
    Sends an automated email confirmation with the attendee's digital ticket
    number, QR pass link, and entry instructions.
    """
    subject = f"🎟️ Your Digital Ticket Pass: {event.title}"
    recipient = ticket.attendee_email

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

GATE CHECK-IN INSTRUCTIONS:
Please show your digital QR pass at the entrance terminal upon arrival for instant check-in.
You can view and save your official QR ticket pass here:
https://eventlaya.com/ticket/{ticket.qr_token}

Organized via Eventlaya Platform
Eastern Nepal Hub • Dharan • Itahari • Biratnagar
"""

    html_content = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0;">
        <div style="background: linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%); padding: 32px 24px; text-align: center; color: #ffffff;">
            <span style="background: rgba(255, 255, 255, 0.2); padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; margin-bottom: 12px;">Verified Eventlaya Pass</span>
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
                <tr>
                    <td style="padding: 8px 0; color: #64748b;">Attendee Email</td>
                    <td style="padding: 8px 0; color: #1e293b; font-weight: 600; text-align: right;">{ticket.attendee_email}</td>
                </tr>
            </table>

            <div style="text-align: center; margin: 28px 0 16px;">
                <a href="https://eventlaya.com/ticket/{ticket.qr_token}" style="background: #4F46E5; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 12px; font-size: 14px; font-weight: 700; display: inline-block;">View Digital QR Pass</a>
            </div>
            
            <p style="font-size: 11px; color: #94a3b8; text-align: center; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 16px;">
                Powered by Eventlaya — Event Management SaaS & Services Marketplace for Eastern Nepal (Dharan • Itahari • Biratnagar)
            </p>
        </div>
    </div>
    """

    try:
        send_mail(
            subject=subject,
            message=text_content,
            from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', 'passes@eventlaya.com'),
            recipient_list=[recipient],
            html_message=html_content,
            fail_silently=True,
        )
        logger.info(f"Ticket email dispatched to {recipient} for {ticket.ticket_number}")
        return True
    except Exception as e:
        logger.warning(f"Failed to send ticket email to {recipient}: {e}")
        return False
