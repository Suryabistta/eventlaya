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
