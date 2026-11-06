from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from apps.events.models import Event, EventGate, EventTicket, GateScanLog, StaffGateAssignment

User = get_user_model()


class GateTestBase(APITestCase):
    def setUp(self):
        self.organizer = User.objects.create_user(username='org', email='org@test.com', password='x', role=User.Role.ORGANIZER)
        self.other_org = User.objects.create_user(username='org2', email='org2@test.com', password='x', role=User.Role.ORGANIZER)
        self.admin = User.objects.create_user(username='admin', email='admin@test.com', password='x', role=User.Role.SUPERADMIN)
        self.staff = User.objects.create_user(username='staff', email='staff@test.com', password='x', role=User.Role.STAFF)
        self.stranger_staff = User.objects.create_user(username='staff2', email='staff2@test.com', password='x', role=User.Role.STAFF)
        today = date.today()
        self.event = Event.objects.create(
            organizer=self.organizer, title='Gate Fest', slug='gate-fest', location='Dharan',
            start_date=today, end_date=today + timedelta(days=1), status=Event.Status.PUBLISHED,
        )
        self.main = EventGate.objects.create(event=self.event, name='Main gate', order=0)
        self.exit = EventGate.objects.create(event=self.event, name='Exit B', kind=EventGate.Kind.EXIT, order=1)
        StaffGateAssignment.objects.create(staff=self.staff, event=self.event, gate=self.main, gate_name=self.main.name)
        self.ticket = EventTicket.generate_ticket(self.event, 'Aarati Rai', 'aarati@test.com')

    def url(self, suffix=''):
        return f'/api/events/{self.event.id}/{suffix}'


class GateCrudTests(GateTestBase):
    def test_owner_can_create_list_update_reorder(self):
        self.client.force_authenticate(self.organizer)
        res = self.client.post(self.url('gates/'), {'name': 'VIP lane', 'kind': 'entry', 'is_vip': True}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertEqual(res.data['order'], 2)
        self.assertTrue(res.data['is_vip'])
        self.assertEqual(res.data['staff'], [])
        gate_id = res.data['id']

        res = self.client.get(self.url('gates/'))
        self.assertEqual([g['name'] for g in res.data], ['Main gate', 'Exit B', 'VIP lane'])
        self.assertIn('scans_in_today', res.data[0])
        self.assertEqual(res.data[0]['staff'][0]['staff_email'], 'staff@test.com')

        res = self.client.patch(self.url(f'gates/{gate_id}/'), {'order': 0, 'name': 'VIP entrance'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['name'], 'VIP entrance')

    def test_rename_syncs_assignment_gate_name(self):
        self.client.force_authenticate(self.organizer)
        self.client.patch(self.url(f'gates/{self.main.id}/'), {'name': 'North gate'}, format='json')
        self.assertEqual(StaffGateAssignment.objects.get(staff=self.staff).gate_name, 'North gate')

    def test_duplicate_name_rejected(self):
        self.client.force_authenticate(self.organizer)
        res = self.client.post(self.url('gates/'), {'name': 'main GATE'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('already exists', str(res.data['name']))

    def test_delete_without_scans_removes_gate(self):
        self.client.force_authenticate(self.organizer)
        res = self.client.delete(self.url(f'gates/{self.exit.id}/'))
        self.assertTrue(res.data['deleted'])
        self.assertFalse(EventGate.objects.filter(id=self.exit.id).exists())

    def test_delete_with_scans_deactivates(self):
        GateScanLog.objects.create(event=self.event, ticket=self.ticket, scan_type='gate_in', gate=self.main, gate_name='Main gate')
        self.client.force_authenticate(self.organizer)
        res = self.client.delete(self.url(f'gates/{self.main.id}/'))
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['deleted'])
        self.assertTrue(res.data['deactivated'])
        self.main.refresh_from_db()
        self.assertFalse(self.main.is_active)

    def test_permissions(self):
        # Staff assigned to the event can read gates, without staff lists
        self.client.force_authenticate(self.staff)
        res = self.client.get(self.url('gates/'))
        self.assertEqual(res.status_code, 200)
        self.assertNotIn('staff', res.data[0])
        self.assertEqual(self.client.post(self.url('gates/'), {'name': 'X'}, format='json').status_code, 403)
        self.assertEqual(self.client.patch(self.url(f'gates/{self.main.id}/'), {'name': 'X'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(self.url(f'gates/{self.main.id}/')).status_code, 403)
        # Unassigned staff and other organizers can't even read
        self.client.force_authenticate(self.stranger_staff)
        self.assertEqual(self.client.get(self.url('gates/')).status_code, 403)
        self.client.force_authenticate(self.other_org)
        self.assertEqual(self.client.get(self.url('gates/')).status_code, 403)
        self.assertEqual(self.client.post(self.url('gates/'), {'name': 'X'}, format='json').status_code, 403)
        # Anonymous
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.url('gates/')).status_code, 401)
        # Superadmin can write
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(self.url('gates/'), {'name': 'Admin gate'}, format='json').status_code, 201)


class StaffAssignmentTests(GateTestBase):
    def test_assign_by_gate_id_creates_staff_account(self):
        self.client.force_authenticate(self.organizer)
        res = self.client.post('/api/events/staff-assign/', {
            'staff_email': 'new.crew@test.com', 'event_id': str(self.event.id), 'gate_id': str(self.exit.id),
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(res.data['staff_created'])
        self.assertEqual(res.data['gate']['id'], str(self.exit.id))
        a = StaffGateAssignment.objects.get(staff__email='new.crew@test.com')
        self.assertEqual((a.gate_id, a.gate_name, a.staff.role), (self.exit.id, 'Exit B', 'staff'))

    def test_reassign_moves_staff_and_list_returns_gate(self):
        self.client.force_authenticate(self.organizer)
        res = self.client.post('/api/events/staff-assign/', {
            'staff_email': 'staff@test.com', 'event_id': str(self.event.id), 'gate_id': str(self.exit.id),
        }, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(StaffGateAssignment.objects.filter(staff=self.staff, event=self.event).count(), 1)
        res = self.client.get(f'/api/events/staff-assign/?event_id={self.event.id}')
        self.assertEqual(res.data[0]['gate_id'], str(self.exit.id))
        self.assertEqual(res.data[0]['gate_name'], 'Exit B')

    def test_legacy_gate_name_creates_gate(self):
        self.client.force_authenticate(self.organizer)
        res = self.client.post('/api/events/staff-assign/', {
            'staff_email': 'staff2@test.com', 'event_id': str(self.event.id), 'gate_name': 'South gate',
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertTrue(EventGate.objects.filter(event=self.event, name='South gate').exists())

    def test_rejects_foreign_gate_and_non_staff_accounts(self):
        other_event = Event.objects.create(organizer=self.organizer, title='B', slug='b', location='x', start_date=date.today())
        foreign = EventGate.objects.create(event=other_event, name='Main gate')
        self.client.force_authenticate(self.organizer)
        res = self.client.post('/api/events/staff-assign/', {
            'staff_email': 'staff2@test.com', 'event_id': str(self.event.id), 'gate_id': str(foreign.id),
        }, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.post('/api/events/staff-assign/', {
            'staff_email': 'org2@test.com', 'event_id': str(self.event.id), 'gate_id': str(self.main.id),
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.other_org.refresh_from_db()
        self.assertEqual(self.other_org.role, 'organizer')

    def test_only_owner_manages_assignments(self):
        a = StaffGateAssignment.objects.get(staff=self.staff)
        for user in (self.other_org, self.staff):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get(f'/api/events/staff-assign/?event_id={self.event.id}').status_code, 403)
            self.assertEqual(self.client.post('/api/events/staff-assign/', {
                'staff_email': 'x@test.com', 'event_id': str(self.event.id), 'gate_id': str(self.main.id)}, format='json').status_code, 403)
            self.assertEqual(self.client.delete('/api/events/staff-assign/', {'assignment_id': str(a.id)}, format='json').status_code, 403)
        self.client.force_authenticate(self.organizer)
        self.assertEqual(self.client.delete('/api/events/staff-assign/', {'assignment_id': str(a.id)}, format='json').status_code, 200)
        self.assertFalse(StaffGateAssignment.objects.filter(id=a.id).exists())

    def test_my_assignment_returns_gate(self):
        self.client.force_authenticate(self.staff)
        res = self.client.get('/api/events/my-assignment/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['gate']['id'], str(self.main.id))
        self.assertEqual(res.data['gate_name'], 'Main gate')
        res = self.client.get(f'/api/events/my-assignment/?event_id={self.event.id}')
        self.assertEqual(res.data['event']['id'], str(self.event.id))
        self.client.force_authenticate(self.stranger_staff)
        self.assertEqual(self.client.get('/api/events/my-assignment/').status_code, 404)


class GateScanRulesTests(GateTestBase):
    def scan(self, **data):
        data.setdefault('qr_token', self.ticket.qr_token)
        return self.client.post(self.url('gate/scan/'), data, format='json')

    def test_scan_with_gate_id_logs_gate(self):
        self.client.force_authenticate(self.staff)
        res = self.scan(scan_type='gate_in', gate_id=str(self.main.id))
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['result'], 'success')
        log = GateScanLog.objects.get(ticket=self.ticket)
        self.assertEqual((log.gate_id, log.gate_name), (self.main.id, 'Main gate'))

    def test_exit_only_gate_rejects_gate_in(self):
        self.client.force_authenticate(self.organizer)
        res = self.scan(scan_type='gate_in', gate_id=str(self.exit.id))
        self.assertEqual(res.status_code, 400)
        self.assertIn('exit-only', res.data['error'])
        self.assertEqual(res.data['result'], 'exit_only')
        self.assertFalse(GateScanLog.objects.exists())

    def test_entry_only_gate_rejects_gate_out(self):
        entry = EventGate.objects.create(event=self.event, name='In only', kind='entry')
        self.client.force_authenticate(self.organizer)
        res = self.scan(scan_type='gate_out', gate_id=str(entry.id))
        self.assertEqual(res.status_code, 400)
        self.assertIn('entry-only', res.data['error'])
        self.assertEqual(res.data['result'], 'entry_only')

    def test_inactive_and_foreign_gates_rejected(self):
        self.main.is_active = False
        self.main.save()
        self.client.force_authenticate(self.organizer)
        self.assertEqual(self.scan(scan_type='gate_in', gate_id=str(self.main.id)).status_code, 400)
        # gate_name matching a closed gate is rejected too
        self.assertEqual(self.scan(scan_type='gate_in', gate_name='main gate').status_code, 400)
        other_event = Event.objects.create(organizer=self.organizer, title='B', slug='b', location='x', start_date=date.today())
        foreign = EventGate.objects.create(event=other_event, name='Main gate')
        self.assertEqual(self.scan(scan_type='gate_in', gate_id=str(foreign.id)).status_code, 400)

    def test_gate_name_fallback(self):
        self.client.force_authenticate(self.organizer)
        res = self.scan(scan_type='gate_in', gate_name='Exit B')
        self.assertEqual(res.status_code, 400)  # matched gate is exit-only
        res = self.scan(scan_type='gate_in', gate_name='Manual Terminal')
        self.assertEqual(res.status_code, 200)  # free-text label from older clients
        self.assertIsNone(GateScanLog.objects.get(ticket=self.ticket).gate_id)

    def test_staff_locked_to_assigned_gate(self):
        both = EventGate.objects.create(event=self.event, name='Side gate')
        self.client.force_authenticate(self.staff)
        res = self.scan(scan_type='gate_in', gate_id=str(both.id))
        self.assertEqual(res.status_code, 403)
        # Staff scanning with no gate (older app) is logged at their assigned gate
        res = self.scan(scan_type='gate_in')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(GateScanLog.objects.get(ticket=self.ticket).gate_id, self.main.id)

    def test_scan_stats_and_tickets_require_event_access(self):
        for path, method in (('gate/scan/', 'post'), ('gate/stats/', 'get'), ('tickets/', 'get')):
            self.client.force_authenticate(None)
            r = getattr(self.client, method)(self.url(path), {'qr_token': self.ticket.qr_token, 'scan_type': 'gate_in'} if method == 'post' else None, format='json')
            self.assertEqual(r.status_code, 401, path)
            for user in (self.stranger_staff, self.other_org):
                self.client.force_authenticate(user)
                r = getattr(self.client, method)(self.url(path), {'qr_token': self.ticket.qr_token, 'scan_type': 'gate_in'} if method == 'post' else None, format='json')
                self.assertEqual(r.status_code, 403, path)
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.get(self.url('gate/stats/')).status_code, 200)
        self.assertEqual(self.client.get(self.url('tickets/')).status_code, 200)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(self.url('tickets/')).status_code, 200)
