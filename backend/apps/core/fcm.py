"""Firebase Cloud Messaging push notification utility."""
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def send_push_notification(token: str, title: str, body: str, data: Optional[dict] = None) -> bool:
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

        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data={str(k): str(v) for k, v in (data or {}).items()},
            token=token,
            android=messaging.AndroidConfig(
                priority='high',
                notification=messaging.AndroidNotification(
                    sound='default',
                    channel_id='eventlaya_scanner',
                ),
            ),
            apns=messaging.APNSConfig(
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(sound='default', badge=1),
                ),
            ),
        )
        messaging.send(message)
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
