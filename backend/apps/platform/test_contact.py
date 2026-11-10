from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import ContactMessage

User = get_user_model()


class ContactFormTests(APITestCase):
    def test_send_list_and_mark_done(self):
        url = '/api/platform/contact/'
        self.assertEqual(self.client.post(url, {'name': 'Sita', 'email': 'bad', 'message': 'Hi'}, format='json').status_code, 400)
        r = self.client.post(url, {'name': 'Sita', 'email': 'sita@x.com', 'role': 'business', 'message': 'We run a college fest.'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        for _ in range(4):
            self.client.post(url, {'name': 'S', 'email': 's@x.com', 'message': 'again'}, format='json')
        self.assertEqual(self.client.post(url, {'name': 'S', 'email': 's@x.com', 'message': 'spam'}, format='json').status_code, 429)
        self.assertEqual(self.client.get('/api/platform/contact/messages/').status_code, 401)
        admin = User.objects.create_user(username='a', email='a@x.com', password='x', role='superadmin')
        self.client.force_authenticate(admin)
        rows = self.client.get('/api/platform/contact/messages/').data
        self.assertEqual(len(rows), 5)
        self.assertEqual(self.client.get('/api/platform/stats/').data['pending']['contact_messages'], 5)
        m = ContactMessage.objects.get(name='Sita')
        self.assertTrue(self.client.patch(f'/api/platform/contact/messages/{m.id}/', {'handled': True}, format='json').data['handled'])
