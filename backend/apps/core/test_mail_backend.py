from unittest import mock

from django.core import mail
from django.core.mail import EmailMessage
from django.core.mail.backends.smtp import EmailBackend
from django.test import SimpleTestCase, TestCase, override_settings

from .mail_backend import PacedSMTPBackend


@override_settings(EMAIL_REPLY_TO='support@eventlaya.com', EMAIL_MIN_INTERVAL=0)
class PacedSMTPBackendTests(SimpleTestCase):
    def _backend(self, results):
        backend = PacedSMTPBackend(fail_silently=True)
        patches = [
            mock.patch.object(EmailBackend, 'open', return_value=True),
            mock.patch.object(EmailBackend, 'close'),
            mock.patch.object(EmailBackend, 'send_messages', side_effect=results),
            mock.patch('apps.core.mail_backend.time.sleep'),
        ]
        mocks = [p.start() for p in patches]
        for p in patches:
            self.addCleanup(p.stop)
        return backend, mocks[2]

    def test_adds_reply_to_unless_set(self):
        backend, send = self._backend([1, 1])
        plain = EmailMessage('a', 'b', 'x@eventlaya.com', ['g@example.com'])
        own = EmailMessage('a', 'b', 'x@eventlaya.com', ['g@example.com'], reply_to=['sita@example.com'])
        self.assertEqual(backend.send_messages([plain, own]), 2)
        self.assertEqual(plain.reply_to, ['support@eventlaya.com'])
        self.assertEqual(own.reply_to, ['sita@example.com'])

    def test_retries_a_refused_email_once(self):
        backend, send = self._backend([0, 1, 0, 0])
        msgs = [EmailMessage('a', 'b', 'x@eventlaya.com', [f'g{i}@example.com']) for i in range(2)]
        self.assertEqual(backend.send_messages(msgs), 1)  # first went through on retry, second failed twice
        self.assertEqual(send.call_count, 4)


class ContactEmailTests(TestCase):
    @override_settings(CONTACT_INBOX='support@eventlaya.com')
    def test_contact_form_emails_support_with_reply_to_the_sender(self):
        r = self.client.post('/api/platform/contact/',
                             {'name': 'Sita', 'email': 'sita@example.com', 'phone': '9800000000', 'message': 'Hello'},
                             content_type='application/json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['support@eventlaya.com'])
        self.assertEqual(mail.outbox[0].reply_to, ['sita@example.com'])
