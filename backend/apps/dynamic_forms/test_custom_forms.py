import io
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APITestCase

from apps.events.models import Event
from .models import Form, FormField

User = get_user_model()
T = FormField.FieldType


class CustomFormTests(APITestCase):
    def setUp(self):
        org = User.objects.create_user(username='org', email='org@x.com', password='x', role=User.Role.ORGANIZER)
        self.event = Event.objects.create(organizer=org, title='Miss Koshi', slug='miss-koshi', location='Dharan',
                                          start_date=date.today() + timedelta(days=30), status='published',
                                          registration_mode='form')
        self.form = Form.objects.create(organizer=org, event=self.event, title='Apply', slug='apply', status='published')
        self.event.registration_form = self.form
        self.event.save()
        f = lambda **kw: FormField.objects.create(form=self.form, **kw)  # noqa: E731
        f(label='About you', field_type=T.HEADING, order=0, required=True)
        self.dob = f(label='Date of birth', field_type=T.DATE, required=True, order=1, validation_rules={'min_age': 18, 'max_age': 28})
        self.height = f(label='Height (cm)', field_type=T.NUMBER, required=True, order=2, validation_rules={'min': 140, 'max': 210})
        self.city = f(label='City', field_type=T.SELECT, options=['Dharan', 'Itahari'], order=3)
        self.link = f(label='Portfolio', field_type=T.URL, order=4)
        self.photo = f(label='Portrait', field_type=T.IMAGE, order=5)

    def submit(self, **answers):
        base = {str(self.dob.id): (date.today() - timedelta(days=365 * 21)).isoformat(), str(self.height.id): '168'}
        base.update({str(getattr(self, k).id): v for k, v in answers.items()})
        return self.client.post('/api/forms/events/miss-koshi/register/', {'name': 'Sita', 'email': 's@x.com', 'answers': base}, format='json')

    def upload(self, data, name='p.png'):
        return self.client.post('/api/forms/events/miss-koshi/upload/', {'file': SimpleUploadedFile(name, data)}, format='multipart')

    def test_rules_are_enforced_on_the_server(self):
        too_young = (date.today() - timedelta(days=365 * 15)).isoformat()
        self.assertIn('at least 18', self.submit(dob=too_young).data['error'])
        self.assertIn('at most 210', self.submit(height='250').data['error'])
        self.assertIn('must be a number', self.submit(height='tall').data['error'])
        self.assertIn('Choose one of the options', self.submit(city='Kathmandu').data['error'])
        self.assertIn('https://', self.submit(link='my site').data['error'])
        self.assertIn('Upload the file', self.submit(photo='https://evil.example/x.png').data['error'])
        self.assertEqual(self.submit(city='Dharan', link='https://vimeo.com/1').status_code, 201)

    def test_guest_uploads_a_photo_and_uses_it(self):
        buf = io.BytesIO()
        Image.new('RGB', (4, 4)).save(buf, 'PNG')
        r = self.upload(buf.getvalue())
        self.assertEqual(r.status_code, 201, r.data)
        self.assertIn(f'/uploads/forms/{self.event.id}/', r.data['url'])
        self.assertEqual(self.submit(photo=r.data['url']).status_code, 201)
        self.assertEqual(self.upload(b'%PDF-1.4 test', 'cv.pdf').status_code, 201)
        self.assertEqual(self.upload(b'not a file', 'x.exe').status_code, 400)


class PhaseBTests(APITestCase):
    """Conditional questions, questions per ticket type, form templates and bib numbers."""

    def setUp(self):
        from apps.events.models import TicketType
        self.org = User.objects.create_user(username='org2', email='org2@x.com', password='x', role=User.Role.ORGANIZER)
        self.event = Event.objects.create(organizer=self.org, title='Dharan Run', slug='run', location='Dharan',
                                          start_date=date.today() + timedelta(days=30), status='published', bib_numbers=True, bib_start=100)
        self.general = TicketType.objects.create(event=self.event, name='General', price=0)
        self.vip = TicketType.objects.create(event=self.event, name='VIP', price=0)
        self.form = Form.objects.create(organizer=self.org, event=self.event, title='Runner', slug='runner', status='published')
        self.event.registration_form = self.form
        self.event.save()
        f = lambda **kw: FormField.objects.create(form=self.form, **kw)  # noqa: E731
        self.race = f(label='Race', field_type=T.RADIO, options=['5K', '21K'], required=True, order=1)
        self.time = f(label='Best 21K time', field_type=T.TEXT, required=True, order=2, show_if={'field': str(self.race.id), 'values': ['21K']})
        self.meal = f(label='VIP meal', field_type=T.SELECT, options=['Veg', 'Non-veg'], required=True, order=3, ticket_types=[str(self.vip.id)])

    def register(self, email, ticket, answers):
        return self.client.post('/api/forms/events/run/register/', {
            'name': 'Ram', 'email': email, 'items': [{'ticket_type_id': str(ticket.id), 'quantity': 1}],
            'answers': {str(k.id): v for k, v in answers.items()}}, format='json')

    def test_conditional_and_ticket_type_questions(self):
        self.assertEqual(self.register('a@x.com', self.general, {self.race: '5K'}).status_code, 201)  # time and meal hidden
        self.assertIn('Best 21K time', self.register('b@x.com', self.general, {self.race: '21K'}).data['error'])
        self.assertEqual(self.register('b@x.com', self.general, {self.race: '21K', self.time: '1:45'}).status_code, 201)
        self.assertIn('VIP meal', self.register('c@x.com', self.vip, {self.race: '5K'}).data['error'])
        r = self.register('c@x.com', self.vip, {self.race: '5K', self.meal: 'Veg', self.time: 'ignored'})
        self.assertEqual(r.status_code, 201)
        from .models import FormAnswer
        self.assertFalse(FormAnswer.objects.filter(field=self.time, response__submitter_email='c@x.com').exists())  # hidden answer dropped

    def test_bibs_in_registration_order_from_the_start_number(self):
        self.register('a@x.com', self.general, {self.race: '5K'})
        r = self.register('b@x.com', self.general, {self.race: '5K'})
        self.assertEqual([r.data['ticket']['bib_number']], [101])
        from apps.events.models import EventTicket
        self.assertEqual(sorted(EventTicket.objects.values_list('bib_number', flat=True)), [100, 101])

    def test_save_as_template_and_reuse(self):
        self.client.force_authenticate(self.org)
        r = self.client.post(f'/api/forms/{self.form.id}/duplicate/', {'as_template': True, 'title': 'My run form'}, format='json')
        self.assertEqual((r.status_code, r.data['is_template'], len(r.data['fields'])), (201, True, 3))
        tpl = r.data
        time_copy = next(f for f in tpl['fields'] if f['label'] == 'Best 21K time')
        race_copy = next(f for f in tpl['fields'] if f['label'] == 'Race')
        self.assertEqual(time_copy['show_if']['field'], race_copy['id'])  # condition points at the copy
        other = Event.objects.create(organizer=self.org, title='Itahari Run', slug='run2', location='Itahari',
                                     start_date=date.today() + timedelta(days=40), status='published')
        r = self.client.post(f"/api/forms/{tpl['id']}/duplicate/", {'event': str(other.id), 'link': 'registration'}, format='json')
        other.refresh_from_db()
        self.assertEqual((r.status_code, str(other.registration_form_id), r.data['status']), (201, r.data['id'], 'published'))
