import io
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from PIL import Image
from rest_framework.test import APITestCase

User = get_user_model()
TMP_MEDIA = tempfile.mkdtemp()


def png_bytes(size=(8, 8)):
    buf = io.BytesIO()
    Image.new('RGB', size, '#C2215A').save(buf, format='PNG')
    return buf.getvalue()


@override_settings(MEDIA_ROOT=TMP_MEDIA)
class ImageUploadTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TMP_MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_user(username='u', email='u@x.com', password='password123')

    def test_requires_login(self):
        res = self.client.post('/api/uploads/', {'file': SimpleUploadedFile('a.png', png_bytes())}, format='multipart')
        self.assertIn(res.status_code, (401, 403))

    def test_uploads_png_and_returns_media_url(self):
        self.client.force_authenticate(self.user)
        res = self.client.post(
            '/api/uploads/', {'file': SimpleUploadedFile('logo.png', png_bytes((20, 10))), 'kind': 'logo'}, format='multipart'
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(res.data['url'].startswith('/media/uploads/logo/'))
        self.assertTrue(res.data['url'].endswith('.png'))
        self.assertEqual((res.data['width'], res.data['height']), (20, 10))

    def test_rejects_non_images_and_svg(self):
        self.client.force_authenticate(self.user)
        res = self.client.post('/api/uploads/', {'file': SimpleUploadedFile('x.png', b'not an image')}, format='multipart')
        self.assertEqual(res.status_code, 400)
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        res = self.client.post('/api/uploads/', {'file': SimpleUploadedFile('x.svg', svg)}, format='multipart')
        self.assertEqual(res.status_code, 400)

    def test_rejects_large_files(self):
        self.client.force_authenticate(self.user)
        big = SimpleUploadedFile('big.png', png_bytes() + b'0' * (5 * 1024 * 1024))
        res = self.client.post('/api/uploads/', {'file': big}, format='multipart')
        self.assertEqual(res.status_code, 400)


@override_settings(MEDIA_ROOT=TMP_MEDIA)
class EventBannerUploadTests(APITestCase):
    def test_banner_url_from_upload_is_attached_and_can_be_cleared(self):
        from apps.events.models import Event
        user = User.objects.create_user(username='o', email='o@x.com', password='password123')
        self.client.force_authenticate(user)
        url = self.client.post('/api/uploads/', {'file': SimpleUploadedFile('b.png', png_bytes()), 'kind': 'banner'}, format='multipart').data['url']
        res = self.client.post('/api/events/', {'title': 'Banner test', 'location': 'Dharan', 'start_date': '2030-01-01', 'banner_url': url}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(res.data['banner'].endswith(url))
        event_id = res.data['id']
        res = self.client.patch(f'/api/events/{event_id}/', {'banner_url': ''}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertFalse(Event.objects.get(id=event_id).banner)

    def test_rejects_outside_paths(self):
        user = User.objects.create_user(username='p', email='p@x.com', password='password123')
        self.client.force_authenticate(user)
        res = self.client.post('/api/events/', {'title': 'X', 'location': 'D', 'start_date': '2030-01-01', 'banner_url': 'https://evil.example/x.png'}, format='json')
        self.assertEqual(res.status_code, 400)


class FcmPayloadTests(SimpleTestCase):
    """The Android/iOS parts of the push: these values must match the Flutter app's resources and channel."""

    def android(self, data=None, **kw):
        from apps.core import fcm
        return fcm.build_message('tok', 'New booking request', 'Asha · Palace · Sat', data, **kw).android

    def test_android_notification_is_branded_high_priority_and_private(self):
        from datetime import timedelta
        android = self.android({'type': 'booking_request', 'inquiry_id': 'abc', 'kind': 'venue'})
        self.assertEqual(android.priority, 'high')
        self.assertEqual(android.ttl, timedelta(hours=24))
        n = android.notification
        self.assertEqual((n.icon, n.color, n.channel_id), ('ic_stat_eventlaya', '#C2215A', 'eventlaya_alerts'))
        self.assertTrue(n.default_sound)
        self.assertTrue(n.default_vibrate_timings)
        self.assertEqual(n.visibility, 'private')
        self.assertEqual(n.tag, 'booking:abc')
        self.assertIsNone(n.notification_count)

    def test_wire_format(self):
        """What actually goes to FCM (the SDK's encoder), so a renamed field can't slip through."""
        from firebase_admin import _messaging_encoder
        from apps.core import fcm
        msg = fcm.build_message('tok', 'Ops', 'Org: Doors open',
                                {'type': 'chat_message', 'conversation_id': 'c1', 'message_id': 'm1'}, count=3)
        wire = _messaging_encoder.MessageEncoder().default(msg)
        self.assertEqual(wire['notification'], {'title': 'Ops', 'body': 'Org: Doors open'})
        self.assertEqual(wire['data'], {'type': 'chat_message', 'conversation_id': 'c1', 'message_id': 'm1'})
        android = wire['android']
        self.assertEqual((android['priority'], android['ttl']), ('high', '86400s'))
        self.assertEqual(android['notification'], {
            'icon': 'ic_stat_eventlaya', 'color': '#C2215A', 'channel_id': 'eventlaya_alerts', 'tag': 'chat:c1',
            'default_sound': True, 'default_vibrate_timings': True, 'notification_priority': 'PRIORITY_HIGH',
            'visibility': 'PRIVATE', 'notification_count': 3,
        })
        self.assertEqual(wire['apns']['payload']['aps'], {'sound': 'default', 'badge': 3, 'thread-id': 'chat:c1'})

    def test_tags(self):
        from apps.core.fcm import notification_tag
        self.assertEqual(notification_tag({'type': 'chat_message', 'conversation_id': 'c1'}), 'chat:c1')
        self.assertEqual(notification_tag({'type': 'booking_cancelled', 'inquiry_id': 'i1'}), 'booking:i1')
        self.assertIsNone(notification_tag({'type': 'admin_broadcast', 'event_id': 'e1'}))
        self.assertIsNone(notification_tag(None))

    def test_send_without_credentials_is_a_no_op(self):
        from unittest import mock
        from apps.core import fcm
        with mock.patch.dict('os.environ', {'FIREBASE_CREDENTIALS_PATH': ''}), \
                mock.patch('firebase_admin._apps', {}), \
                mock.patch('firebase_admin.messaging.send') as send:
            self.assertFalse(fcm.send_push_notification('tok', 't', 'b'))
        send.assert_not_called()

    def test_send_passes_the_built_message(self):
        from unittest import mock
        from apps.core import fcm
        with mock.patch('firebase_admin._apps', {'[DEFAULT]': object()}), \
                mock.patch('firebase_admin.messaging.send') as send:
            self.assertTrue(fcm.send_push_notification('tok-1', 'Hi', 'There', {'type': 'x'}, count=2))
        msg = send.call_args.args[0]
        self.assertEqual((msg.token, msg.android.notification.notification_count), ('tok-1', 2))
