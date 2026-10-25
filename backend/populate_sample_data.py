import os
import django
from datetime import date, time, timedelta

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from django.utils import timezone
from apps.events.models import Event, EventTicket, GateScanLog
from apps.dynamic_forms.models import Form, FormField, FormResponse, FormAnswer
from apps.voting.models import Poll, Candidate, Vote
from apps.marketplace.models import VendorCategory, VendorProfile

User = get_user_model()

def populate():
    print("🌱 Populating Eventlaya sample data...")

    # 1. Organizer User
    organizer, created = User.objects.get_or_create(
        email='organizer@eventlaya.com',
        defaults={
            'username': 'organizer',
            'phone': '+977-9800000001',
            'role': User.Role.ORGANIZER,
            'organization_name': 'Eastern Tech Innovators Club',
        }
    )
    if created:
        organizer.set_password('password123')
        organizer.save()
        print("  ✓ Created organizer user: organizer@eventlaya.com (pw: password123)")
    else:
        print("  ✓ Found existing organizer user")

    # 2. Dynamic Form
    form, created = Form.objects.get_or_create(
        organizer=organizer,
        slug='eastern-tech-fest-reg',
        defaults={
            'title': 'Eastern Tech Fest Registration Form',
            'description': 'Please fill out your details to receive your digital QR entry pass.',
            'status': Form.Status.PUBLISHED,
            'allow_multiple_submissions': False,
        }
    )
    if created:
        print("  ✓ Created dynamic registration form")

    # Fields
    fields_spec = [
        ('Full Name', FormField.FieldType.TEXT, 'Your official name', True, 1, []),
        ('Mobile Phone Number', FormField.FieldType.PHONE, '+977-98XXXXXXXX', True, 2, []),
        ('Institution / College', FormField.FieldType.TEXT, 'e.g. Purwanchal Campus, Dharan', True, 3, []),
        ('Hackathon Track', FormField.FieldType.SELECT, 'Choose your primary track', True, 4, [
            'Web & Mobile Development', 'AI & Machine Learning', 'Cybersecurity & CTF', 'UI/UX Design'
        ]),
        ('T-Shirt Size', FormField.FieldType.RADIO, '', True, 5, ['S', 'M', 'L', 'XL', 'XXL']),
        ('Dietary Preference', FormField.FieldType.SELECT, '', False, 6, ['Non-Veg', 'Veg', 'Vegan']),
        ('Need Overnight Accommodation?', FormField.FieldType.RADIO, '', True, 7, ['Yes (Hostel)', 'No (Local)']),
    ]

    form_fields = []
    for label, ftype, placeholder, req, order, opts in fields_spec:
        fld, _ = FormField.objects.get_or_create(
            form=form,
            label=label,
            defaults={
                'field_type': ftype,
                'placeholder': placeholder,
                'required': req,
                'order': order,
                'options': opts,
            }
        )
        form_fields.append(fld)

    # 3. Featured Event
    event, created = Event.objects.get_or_create(
        organizer=organizer,
        slug='eastern-tech-fest-2026',
        defaults={
            'title': 'Eastern Tech Fest & Hackathon 2026',
            'description': 'The largest tech symposium and 24-hour hackathon in Eastern Nepal. Featuring keynote talks, robotic exhibitions, hackathon challenges, and live entertainment in Dharan.',
            'location': 'Purwanchal Campus Auditorium, Dharan',
            'start_date': date.today() + timedelta(days=2),
            'start_time': time(9, 0),
            'end_date': date.today() + timedelta(days=3),
            'end_time': time(18, 0),
            'capacity': 500,
            'status': Event.Status.PUBLISHED,
            'allow_registration': True,
            'is_paid': False,
            'ticket_price': 0.00,
            'registration_form': form,
        }
    )
    if created or event.registration_form != form:
        event.registration_form = form
        event.save()
        print("  ✓ Created featured event: Eastern Tech Fest & Hackathon 2026")

    # Link form to event
    form.event = event
    form.save()

    # 4. Sample Attendees & Tickets
    sample_attendees = [
        ('Aarav Sharma', 'aarav.sharma@gmail.com', '+977-9812345671', EventTicket.Status.CHECKED_IN, 'L', 'Web & Mobile Development'),
        ('Pooja Karki', 'pooja.karki@gmail.com', '+977-9812345672', EventTicket.Status.CHECKED_IN, 'M', 'AI & Machine Learning'),
        ('Rohan Shrestha', 'rohan.shrestha@gmail.com', '+977-9812345673', EventTicket.Status.CHECKED_OUT, 'XL', 'Cybersecurity & CTF'),
        ('Sneha Adhikari', 'sneha.adhikari@gmail.com', '+977-9812345674', EventTicket.Status.VALID, 'S', 'UI/UX Design'),
        ('Bikash Thapa', 'bikash.thapa@gmail.com', '+977-9812345675', EventTicket.Status.VALID, 'M', 'Web & Mobile Development'),
    ]

    now = timezone.now()
    for name, email, phone, status_choice, tshirt, track in sample_attendees:
        ticket, t_created = EventTicket.objects.get_or_create(
            event=event,
            attendee_email=email,
            defaults={
                'attendee_name': name,
                'attendee_phone': phone,
                'ticket_number': f"TKT-ETF26-{str(EventTicket.objects.filter(event=event).count() + 1).zfill(4)}",
                'qr_token': f"token-{email.split('@')[0]}",
                'status': status_choice,
                'is_attended': status_choice in [EventTicket.Status.CHECKED_IN, EventTicket.Status.CHECKED_OUT],
                'first_check_in': now - timedelta(hours=2) if status_choice in [EventTicket.Status.CHECKED_IN, EventTicket.Status.CHECKED_OUT] else None,
                'last_activity': now - timedelta(minutes=15) if status_choice == EventTicket.Status.CHECKED_OUT else now - timedelta(hours=2),
            }
        )

        # Log Gate Scans
        if status_choice == EventTicket.Status.CHECKED_IN:
            GateScanLog.objects.get_or_create(
                event=event,
                ticket=ticket,
                scan_type=GateScanLog.ScanType.GATE_IN,
                defaults={
                    'result': GateScanLog.ScanResult.SUCCESS,
                    'gate_name': 'North Gate Scanner',
                    'scanned_by': organizer,
                }
            )
        elif status_choice == EventTicket.Status.CHECKED_OUT:
            GateScanLog.objects.get_or_create(
                event=event,
                ticket=ticket,
                scan_type=GateScanLog.ScanType.GATE_OUT,
                defaults={
                    'result': GateScanLog.ScanResult.SUCCESS,
                    'gate_name': 'North Gate Scanner',
                    'scanned_by': organizer,
                }
            )

        # Form response
        resp, r_created = FormResponse.objects.get_or_create(
            form=form,
            event=event,
            ticket=ticket,
            defaults={
                'submitter_name': name,
                'submitter_email': email,
                'submitter_phone': phone,
                'review_status': FormResponse.ReviewStatus.ACCEPTED,
            }
        )
        if r_created:
            for f in form_fields:
                val = name if 'Name' in f.label else (phone if 'Phone' in f.label else (tshirt if 'Size' in f.label else track))
                FormAnswer.objects.create(response=resp, field=f, value=val)

    print("  ✓ Created sample attendee tickets & gate scans")

    # 5. Live Poll & Candidates
    poll, _ = Poll.objects.get_or_create(
        event=event,
        title='Best Student Innovation Pitch Award 2026',
        defaults={
            'description': 'Cast your live vote for the most inspiring project pitch at Eastern Tech Fest.',
            'is_active': True,
            'require_ticket': False,
        }
    )

    candidates_data = [
        ('KrishiSmart AI', 'Automated crop disease diagnosis and soil health analyzer for local farmers.', 48),
        ('Safepath Drone', 'Autonomous search & rescue drone for mountain terrain and river valleys.', 65),
        ('NepalSign VR', 'Interactive Nepali sign language translator using computer vision & VR.', 82),
        ('VoltGrid IoT', 'Smart energy monitor for solar mini-grids in rural schools.', 39),
    ]

    for cname, cbio, votes in candidates_data:
        Candidate.objects.get_or_create(
            poll=poll,
            name=cname,
            defaults={
                'bio': cbio,
                'vote_count': votes,
            }
        )
    print("  ✓ Created live poll & candidates")

    # 6. Marketplace Categories & Vendors
    categories = [
        ('Photography & Video', 'photography-video', 'Camera'),
        ('Sound, Lights & Stage', 'sound-lights', 'Music'),
        ('Venue & Banquets', 'venues', 'Building2'),
        ('Indoor & Outdoor Decoration', 'decorations', 'Sparkles'),
        ('Catering & Food Services', 'catering', 'Utensils'),
    ]

    cat_objs = {}
    for cname, cslug, cicon in categories:
        cat_obj, _ = VendorCategory.objects.get_or_create(
            slug=cslug,
            defaults={'name': cname, 'icon': cicon}
        )
        cat_objs[cslug] = cat_obj

    vendors_data = [
        ('Eastern Lens Studio', 'photography-video', 'Dharan', '+977-9852011223', 'easternlens@gmail.com', 'Professional event coverage, 4K multi-cam live streaming, cinematic drone recap videos.', 15000, 4.9, True, True),
        ('Himalayan Waves Sound & Light', 'sound-lights', 'Itahari', '+977-9842033445', 'info@himalayanwaves.com', 'Line array concert sound, intelligent moving heads, LED walls, and outdoor stage fabrication.', 35000, 4.8, True, True),
        ('Greenwood Banquet & Convention', 'venues', 'Biratnagar', '+977-021-456789', 'contact@greenwoodbanquet.np', 'Air-conditioned hall with 800+ capacity, lush open lawn, generator backup, and secure parking.', 50000, 4.7, True, False),
        ('Koshi Floral & Stage Decors', 'decorations', 'Itahari', '+977-9812055667', 'koshidecors@gmail.com', 'Modern thematic wedding stages, corporate backdrop panels, and entrance light arches.', 20000, 4.9, True, True),
        ('Everest Royal Caterers', 'catering', 'Dharan', '+977-9802077889', 'everestroyal@gmail.com', 'Buffet dining, traditional Nepali feast, continental stations, and hygienic event catering.', 650, 4.8, True, False),
    ]

    for bname, cslug, city, phone, email, desc, price, rating, ver, feat in vendors_data:
        VendorProfile.objects.get_or_create(
            business_name=bname,
            defaults={
                'user': organizer,
                'category': cat_objs[cslug],
                'city': city,
                'phone': phone,
                'email': email,
                'description': desc,
                'starting_price': price,
                'rating': rating,
                'is_verified': ver,
                'is_featured': feat,
            }
        )
    print("  ✓ Created marketplace categories & verified vendors")
    print("🎉 All sample data populated successfully!")

if __name__ == '__main__':
    populate()
