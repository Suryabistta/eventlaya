from rest_framework import status
from rest_framework.test import APITestCase
from django.contrib.auth import get_user_model

User = get_user_model()


class TeamApiTests(APITestCase):
    def setUp(self):
        self.organizer = User.objects.create_user(
            username='org', email='org@example.com', password='password123', role=User.Role.ORGANIZER,
        )
        self.other = User.objects.create_user(
            username='other', email='other@example.com', password='password123', role=User.Role.ORGANIZER,
        )
        self.client.force_authenticate(user=self.organizer)

    def _add(self, **body):
        return self.client.post('/api/auth/team/', {'email': 'crew@example.com', 'first_name': 'Crew', **body}, format='json')

    def test_onboard_creates_staff_with_temporary_password(self):
        res = self._add()
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        member = User.objects.get(email='crew@example.com')
        self.assertEqual(member.role, User.Role.STAFF)
        self.assertEqual(member.team_owner, self.organizer)
        self.assertTrue(member.check_password(res.data['temporary_password']))
        self.assertFalse(member.check_password('password123'))

    def test_list_only_shows_own_team(self):
        self._add()
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self.client.get('/api/auth/team/').data, [])
        self.client.force_authenticate(user=self.organizer)
        self.assertEqual([m['email'] for m in self.client.get('/api/auth/team/').data], ['crew@example.com'])

    def test_cannot_add_another_organizers_staff_or_non_staff(self):
        self._add()
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self._add().status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self._add(email='org@example.com').status_code, status.HTTP_400_BAD_REQUEST)

    def test_deactivate_reset_and_remove(self):
        member_id = self._add().data['id']
        url = f'/api/auth/team/{member_id}/'
        self.assertFalse(self.client.patch(url, {'is_active': False}, format='json').data['is_active'])
        res = self.client.patch(url, {'is_active': True, 'reset_password': True}, format='json')
        member = User.objects.get(id=member_id)
        self.assertTrue(member.is_active)
        self.assertTrue(member.check_password(res.data['temporary_password']))

        self.assertEqual(self.client.delete(url).status_code, status.HTTP_200_OK)
        member.refresh_from_db()
        self.assertIsNone(member.team_owner)
        self.assertFalse(member.is_active)

    def test_other_organizer_cannot_edit_member(self):
        member_id = self._add().data['id']
        self.client.force_authenticate(user=self.other)
        res = self.client.patch(f'/api/auth/team/{member_id}/', {'is_active': False}, format='json')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_staff_cannot_manage_team(self):
        staff = User.objects.create_user(username='s', email='s@example.com', password='x' * 10, role=User.Role.STAFF)
        self.client.force_authenticate(user=staff)
        self.assertEqual(self.client.get('/api/auth/team/').status_code, status.HTTP_403_FORBIDDEN)
