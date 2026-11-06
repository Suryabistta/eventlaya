"""Firebase Cloud Messaging push notification utility."""
import logging
from datetime import timedelta
from typing import Optional

logger = logging.getLogger(__name__)

# Must match the Android app (scanner_app: AndroidManifest.xml meta-data, res/drawable-*/ic_stat_eventlaya.png,
# lib/core/notification_service.dart). The channel is created by the app at launch with high importance.
ANDROID_CHANNEL_ID = 'eventlaya_alerts'
ANDROID_SMALL_ICON = 'ic_stat_eventlaya'
BRAND_COLOR = '#C2215A'
# Pushes are about things happening now (a booking waiting for an answer, a chat message, a gate alert):
# a phone that is off for longer than this gets the email / in-app inbox instead of a stale alert.
DEFAULT_TTL = timedelta(hours=24)


def notification_tag(data: Optional[dict]) -> Optional[str]:
    """One notification per conversation / booking request: a newer push for the same thing replaces the
    older one in the shade, and the app clears it by this tag when the user opens it."""
    data = data or {}
    kind = data.get('type')
    if kind == 'chat_message' and data.get('conversation_id'):
        return f"chat:{data['conversation_id']}"
    if str(kind or '').startswith('booking_') and data.get('inquiry_id'):
        return f"booking:{data['inquiry_id']}"
    return None


def build_message(token: str, title: str, body: str, data: Optional[dict] = None, *,
                  count: Optional[int] = None, ttl: timedelta = DEFAULT_TTL):
    """The FCM message. `notification` + Android `priority='high'` make the OS show it (and wake a dozing
    device) even when the app is killed; `count` is the launcher badge number for this notification."""
    from firebase_admin import messaging

    return messaging.Message(
        notification=messaging.Notification(title=title, body=body),
        data={str(k): str(v) for k, v in (data or {}).items()},
        token=token,
        android=messaging.AndroidConfig(
            priority='high',
            ttl=ttl,
            notification=messaging.AndroidNotification(
                icon=ANDROID_SMALL_ICON,
                color=BRAND_COLOR,
                channel_id=ANDROID_CHANNEL_ID,
                tag=notification_tag(data),
                default_sound=True,
                default_vibrate_timings=True,
                priority='high',  # Android < 8 (no channels)
                # Booking and chat text is personal: on a secure lock screen set to hide sensitive content
                # Android shows only "Eventlaya" + the icon; otherwise the full text, as the user chose.
                visibility='private',
                notification_count=count if count and count > 0 else None,
            ),
        ),
        apns=messaging.APNSConfig(
            headers={'apns-priority': '10'},
            payload=messaging.APNSPayload(
                aps=messaging.Aps(sound='default', badge=count if count and count > 0 else 1,
                                  thread_id=notification_tag(data)),
            ),
        ),
    )


def send_push_notification(token: str, title: str, body: str, data: Optional[dict] = None, *,
                           count: Optional[int] = None, ttl: timedelta = DEFAULT_TTL) -> bool:
    """
    Send a push notification via Firebase Admin SDK.
    Returns True on success, False on failure.
    Gracefully handles missing Firebase config.
    """
    try:
        import firebase_admin
        from firebase_admin import credentials, messaging

        if not firebase_admin._apps:
            import os
            cred_path = os.environ.get('FIREBASE_CREDENTIALS_PATH')
            if not cred_path or not os.path.exists(cred_path):
                logger.warning("FCM: FIREBASE_CREDENTIALS_PATH not set or file not found. Push notification skipped.")
                return False
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)

        messaging.send(build_message(token, title, body, data, count=count, ttl=ttl))
        logger.info(f"FCM: Sent push to token ending ...{token[-8:]}: {title}")
        return True

    except ImportError:
        logger.warning("FCM: firebase-admin not installed. Install with: pip install firebase-admin")
        return False
    except Exception as e:
        logger.error(f"FCM: Failed to send push notification: {e}")
        return False


def send_push_to_event_staff(event, title: str, body: str, data: Optional[dict] = None) -> int:
    """Send push notification to all active staff and organizer assigned to an event."""
    from apps.accounts.models import FCMToken
    
    staff_users = list(event.staff_assignments.filter(is_active=True).values_list('staff_id', flat=True))
    if event.organizer_id and event.organizer_id not in staff_users:
        staff_users.append(event.organizer_id)
        
    tokens = FCMToken.objects.filter(user_id__in=staff_users).values_list('token', flat=True)
    
    sent = 0
    for token in tokens:
        if send_push_notification(token, title, body, data):
            sent += 1
    return sent


def notify_capacity_milestone(event, current_count: int, capacity: int):
    """Send push to organizer + staff when capacity milestones are reached."""
    if capacity <= 0:
        return
    pct = (current_count / capacity) * 100
    milestone = None
    if 50.0 <= pct < 52.0:
        milestone = "50%"
    elif 80.0 <= pct < 82.0:
        milestone = "80%"
    elif pct >= 100.0:
        milestone = "100% — FULL"
    
    if milestone:
        title = f"🎯 {event.title}"
        body = f"Capacity milestone reached: {milestone} ({current_count}/{capacity} attendees)"
        send_push_to_event_staff(event, title, body, {
            "type": "capacity_milestone",
            "event_id": str(event.id),
            "milestone": milestone
        })
