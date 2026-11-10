from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core import mail
from rest_framework.test import APITestCase

from .models import Event, EventTicket, TicketType

User = get_user_model()


class RegistrationOnlyTests(APITestCase):
    def setUp(self):
        self.organizer = User.objects.create_user(username='org', email='org@test.com', password='x', role=User.Role.ORGANIZER)
        self.event = Event.objects.create(
            organizer=self.organizer, title='Dharan Run', slug='run', location='Dharan', capacity=2,
            start_date=date.today() + timedelta(days=10), status=Event.Status.PUBLISHED,
            registration_mode=Event.RegistrationMode.FORM,
        )
        # A paid type left over from before the switch: registration-only ignores prices
        TicketType.objects.create(event=self.event, name='Runner', price=500)
        self.url = '/api/forms/events/run/register/'

    def register(self, email, **extra):
        return self.client.post(self.url, {'name': 'Sita', 'email': email, **extra}, format='json')

    def test_free_single_registration_without_pass(self):
        r = self.register('sita@x.com', items=[{'ticket_type_id': None, 'quantity': 5}], payment_method='online')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(r.data['registration_only'])
        self.assertNotIn('ticket', r.data)
        self.assertNotIn('qr_token', str(r.data))
        t = EventTicket.objects.get(event=self.event)
        self.assertEqual((t.price, t.order.total, t.order.payment_status), (0, 0, 'free'))
        self.assertIn('Registration confirmed', mail.outbox[-1].subject)
        self.assertNotIn('/register?view=pass', mail.outbox[-1].body)

    def test_again_returns_registration_and_capacity_counts(self):
        self.register('sita@x.com')
        again = self.register('sita@x.com', additional=True)
        self.assertEqual((again.status_code, again.data['already_registered']), (200, True))
        self.assertEqual(EventTicket.objects.filter(event=self.event).count(), 1)
        self.assertEqual(self.register('ram@x.com').status_code, 201)
        self.assertEqual(self.register('hari@x.com').status_code, 409)

    def test_my_tickets_hide_the_qr(self):
        user = User.objects.create_user(username='sita', email='sita@x.com', password='x', email_verified=True)
        self.client.force_authenticate(user)
        self.register('sita@x.com')
        from rest_framework.test import APIRequestFactory
        from .my_tickets import my_ticket_data
        request = APIRequestFactory().get('/')
        request.user = user
        data = my_ticket_data(EventTicket.objects.get(event=self.event), request)
        self.assertEqual((data['qr_token'], data['registration_only']), (None, True))

    def test_export_lists_registrations_with_answers(self):
        from apps.dynamic_forms.models import Form, FormField
        form = Form.objects.create(organizer=self.organizer, event=self.event, title='Run form', slug='run-form', status='published')
        size = FormField.objects.create(form=form, label='T-shirt size', field_type='select', options=['S', 'M', 'L'], order=1)
        self.event.registration_form = form
        self.event.save()
        self.register('sita@x.com', answers={str(size.id): 'M'})
        self.client.force_authenticate(self.organizer)
        r = self.client.get(f'/api/events/{self.event.id}/export-attendees/')
        rows = r.content.decode().splitlines()
        self.assertIn('registrations', r['Content-Disposition'])
        self.assertEqual(rows[0], 'Registration No.,Name,Email,Phone,Status,Registered At,T-shirt size')
        self.assertTrue(rows[1].endswith(',registered,' + rows[1].split(',')[5] + ',M'))


class StagesTests(APITestCase):
    """Applications stage next to (or instead of) the tickets stage on one event."""

    def setUp(self):
        from datetime import datetime
        from django.utils import timezone
        from apps.dynamic_forms.models import Form, FormField
        self.organizer = User.objects.create_user(username='org2', email='org2@test.com', password='x', role=User.Role.ORGANIZER)
        self.client.force_authenticate(self.organizer)
        self.form = Form.objects.create(organizer=self.organizer, title='Entry', slug='entry', status='published')
        self.link = FormField.objects.create(form=self.form, label='Film link', field_type='url', required=True, order=1)
        self.close = timezone.make_aware(datetime.combine(date.today() + timedelta(days=20), datetime.min.time().replace(hour=17)))
        r = self.client.post('/api/events/', {
            'title': 'Short Film Festival', 'status': 'published', 'date_tba': True, 'tickets_enabled': False,
            'applications_enabled': True, 'application_form': str(self.form.id), 'applications_close': self.close.isoformat(),
            'application_cta': 'Submit your film',
        }, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.event = Event.objects.get(id=r.data['id'])
        self.client.force_authenticate(None)
        self.apply_url = f'/api/forms/events/{self.event.slug}/apply/'

    def apply(self, email='ram@x.com', link='https://vimeo.com/1'):
        return self.client.post(self.apply_url, {'name': 'Ram', 'email': email, 'phone': '9812345678', 'answers': {str(self.link.id): link}}, format='json')

    def test_applications_only_event_has_no_date_or_venue_yet(self):
        self.assertEqual((self.event.location, self.event.start_date), ('To be announced', self.close.date()))
        self.assertEqual([e['title'] for e in self.client.get('/api/events/public/?kind=open_calls').data], ['Short Film Festival'])
        page = self.client.get(f'/api/events/public/{self.event.slug}/').data['event']
        self.assertEqual((page['applications']['open'], page['applications']['cta']), (True, 'Submit your film'))
        self.assertFalse(page['registration_open'])  # tickets stage is off
        r = self.client.post(f'/api/forms/events/{self.event.slug}/register/', {'name': 'A', 'email': 'a@x.com'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_apply_creates_pending_application_without_ticket_then_review(self):
        self.assertIn('https://', self.apply(link='not a link').data['error'])
        r = self.apply()
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(r.data['application']['number'].startswith('APP-'))
        self.assertEqual(EventTicket.objects.filter(event=self.event).count(), 0)
        self.assertIn('Application received', mail.outbox[-1].subject)
        self.assertTrue(self.apply().data['already_applied'])
        self.client.force_authenticate(self.organizer)
        apps = self.client.get(f'/api/forms/events/{self.event.id}/applications/').data
        self.assertEqual((len(apps), apps[0]['review_status']), (1, 'pending'))
        r = self.client.post(f"/api/forms/responses/{apps[0]['id']}/review/", {'status': 'accepted'}, format='json')
        self.assertEqual(r.data['review_status'], 'accepted')
        self.assertIn('accepted', mail.outbox[-1].subject)
        csv_rows = self.client.get(f'/api/events/{self.event.id}/export-applications/').content.decode().splitlines()
        self.assertEqual(len(csv_rows), 2)
        self.assertIn('accepted', csv_rows[1])

    def test_film_festival_takes_applications_and_sells_tickets_together(self):
        self.client.force_authenticate(self.organizer)
        r = self.client.patch(f'/api/events/{self.event.id}/', {
            'date_tba': False, 'tickets_enabled': True, 'start_date': (date.today() + timedelta(days=40)).isoformat(),
            'location': 'City Hall, Dharan',
        }, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.client.force_authenticate(None)
        self.assertEqual(self.apply().status_code, 201)
        r = self.client.post(f'/api/forms/events/{self.event.slug}/register/', {'name': 'Viewer', 'email': 'v@x.com'}, format='json')
        self.assertEqual((r.status_code, r.data.get('field')), (400, 'phone'))  # phone is required by default
        r = self.client.post(f'/api/forms/events/{self.event.slug}/register/', {'name': 'Viewer', 'email': 'v@x.com', 'phone': '9812345678'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(EventTicket.objects.filter(event=self.event).count(), 1)  # only the viewer has a ticket

    def test_module_off_stops_applications(self):
        from apps.accounts.models import PlatformModule
        from apps.accounts.modules import clear_cache
        PlatformModule.objects.filter(slug='applications').update(is_globally_enabled=False)
        clear_cache()
        self.addCleanup(clear_cache)
        self.assertEqual(self.apply().status_code, 403)


class StageTimelineAndContestTests(StagesTests):
    def test_timeline_and_accepted_applicants_become_contestants(self):
        from apps.dynamic_forms.models import FormField
        from apps.voting.models import Poll
        photo = FormField.objects.create(form=self.form, label='Portrait', field_type='image', order=2)
        bio = FormField.objects.create(form=self.form, label='Short bio', field_type='paragraph', order=3)
        img = self.client.post(f'/api/forms/events/{self.event.slug}/upload/', {'file': _png()}, format='multipart').data['url']
        answers = {str(self.link.id): 'https://vimeo.com/1', str(photo.id): img, str(bio.id): 'I sing.'}
        for email in ('a@x.com', 'b@x.com'):
            r = self.client.post(self.apply_url, {'name': email[0].upper(), 'email': email, 'phone': '9812345678', 'answers': answers}, format='json')
            self.assertEqual(r.status_code, 201, r.data)
        poll = Poll.objects.create(event=self.event, title='Public vote', kind=Poll.Kind.CONTEST, status=Poll.Status.SCHEDULED)
        stages = self.client.get(f'/api/events/public/{self.event.slug}/').data['event']['stages']
        self.assertEqual([(s['kind'], s['state']) for s in stages], [('applications', 'open'), ('voting', 'upcoming'), ('tickets', 'upcoming')])
        self.client.force_authenticate(self.organizer)
        apps = self.client.get(f'/api/forms/events/{self.event.id}/applications/').data
        self.client.post(f"/api/forms/responses/{apps[0]['id']}/review/", {'status': 'accepted'}, format='json')
        url = f'/api/voting/contests/{poll.id}/contestants/from-applications/'
        r = self.client.post(url)
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((len(r.data), r.data[0]['photo_url'], r.data[0]['description']), (1, img, 'I sing.'))
        self.assertEqual(self.client.post(url).status_code, 400)  # nothing new to add


def _png():
    import io
    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image
    buf = io.BytesIO()
    Image.new('RGB', (4, 4)).save(buf, 'PNG')
    return SimpleUploadedFile('p.png', buf.getvalue())
