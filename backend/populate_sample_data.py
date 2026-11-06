import os
import django
from datetime import date, time, timedelta

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from django.utils import timezone
from apps.accounts.models import PlatformModule, RoleModulePermission, TenantBranding
from apps.events.models import Event, EventTicket, EventGate, GateScanLog, StaffGateAssignment, EventFunding, EventTask
from apps.dynamic_forms.models import Form, FormField, FormResponse, FormAnswer
from apps.voting.models import Poll, Candidate, Vote
from apps.marketplace.models import VendorCategory, VendorProfile, VenueListing, VenueSpace, VenueInquiry

User = get_user_model()

ROYAL_PALACE_SPACES = [
    # name, type, seated, standing, price/day, area sqft, amenities, images, description
    ('Sagarmatha Hall', VenueSpace.SpaceType.HALL, 600, 900, 120000, 9500,
     ['Central AC', 'Chandeliers', 'Stage 32 x 16 ft', 'LED wall'],
     ['https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=800&auto=format&fit=crop&q=80'],
     'The main ballroom for wedding receptions and large conventions.'),
    ('Kanchenjunga Hall', VenueSpace.SpaceType.HALL, 350, 500, 75000, 5200,
     ['Central AC', 'Stage', 'Projector'],
     ['https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&auto=format&fit=crop&q=80'],
     'Mid-size hall for engagements, pasni and corporate dinners.'),
    ('Makalu Hall', VenueSpace.SpaceType.CONFERENCE_ROOM, 200, None, 45000, 2800,
     ['Central AC', 'Projector', 'Wi-Fi', 'Podium'],
     [],
     'Theatre or classroom seating for seminars, trainings and AGMs.'),
    ('Garden Lawn', VenueSpace.SpaceType.LAWN, 500, 800, 90000, 12000,
     ['Open air', 'Generator backup', 'Tent on request'],
     [],
     'Open lawn for mehendi, day receptions and outdoor concerts.'),
]


def seed_venue_spaces():
    """Idempotent: give Royal Palace its four bookable spaces."""
    venue = VenueListing.objects.filter(slug='royal-palace-banquet-itahari').first()
    if not venue:
        return
    for order, (name, stype, seated, standing, price, area, amens, imgs, desc) in enumerate(ROYAL_PALACE_SPACES):
        VenueSpace.objects.get_or_create(
            venue=venue,
            name=name,
            defaults={
                'space_type': stype,
                'capacity_seated': seated,
                'capacity_standing': standing,
                'price_per_day': price,
                'area_sqft': area,
                'amenities': amens,
                'images': imgs,
                'description': desc,
                'order': order,
            },
        )


def populate():
    print("🌱 Populating Eventlaya sample data...")

    # 0. Superadmin / Platform Owner
    superadmin, created = User.objects.get_or_create(
        email='superadmin@eventlaya.com',
        defaults={
            'username': 'superadmin',
            'first_name': 'Platform',
            'last_name': 'Superadmin',
            'phone': '+977-9800000000',
            'role': User.Role.SUPERADMIN,
            'is_staff': True,
            'is_superuser': True,
            'organization_name': 'Eventlaya Platform HQ',
        }
    )
    if created:
        superadmin.set_password('password123')
        superadmin.save()
        print("  ✓ Created superadmin user: superadmin@eventlaya.com (pw: password123)")
    else:
        print("  ✓ Found existing superadmin user")

    # 0b. Seed Platform Modules & RBAC Permissions
    modules_data = [
        ('events', 'Events Management', 'Create, manage, and monitor live events and attendee capacity.', 'Calendar', 1),
        ('gate_scanner', 'Gate QR Scanner Terminal', 'Real-time entry/exit QR scanning, attendee roster, and fraud detection.', 'QrCode', 2),
        ('dynamic_forms', 'Dynamic Registration Forms', 'Custom form builder with 10 question types and live preview canvas.', 'FormInput', 3),
        ('voting', 'Live Audience Voting & Polls', 'Cryptographic one-person-one-vote live polling with instant tallies.', 'Vote', 4),
        ('marketplace', 'Vendor Services Marketplace', 'Event vendor directory, RFQ requests, and verified service providers.', 'Store', 5),
        ('staff_management', 'Gate Staff & Assignments', 'Assign station gates, monitor scans, and grant staff privileges.', 'Users', 6),
    ]

    for mslug, mname, mdesc, micon, morder in modules_data:
        mod, _ = PlatformModule.objects.get_or_create(
            slug=mslug,
            defaults={
                'name': mname,
                'description': mdesc,
                'icon': micon,
                'order': morder,
                'is_globally_enabled': True,
            }
        )

        # Ensure default permissions for each role
        for r_code in ['superadmin', 'organizer', 'staff', 'attendee', 'vendor']:
            can_v = True if r_code in ['superadmin', 'organizer'] else (r_code == 'staff' and mslug in ['gate_scanner', 'events'])
            can_c = r_code in ['superadmin', 'organizer']
            can_e = r_code in ['superadmin', 'organizer']
            can_d = r_code == 'superadmin'

            RoleModulePermission.objects.get_or_create(
                role=r_code,
                module=mod,
                defaults={
                    'can_view': can_v,
                    'can_create': can_c,
                    'can_edit': can_e,
                    'can_delete': can_d,
                    'is_enabled': True,
                }
            )
    print("  ✓ Seeded platform modules and RBAC default permissions")

    # 1. Organizer User
    organizer, created = User.objects.get_or_create(
        email='organizer@eventlaya.com',
        defaults={
            'username': 'organizer',
            'first_name': 'Aayush',
            'last_name': 'Shrestha',
            'phone': '+977-9841234567',
            'role': User.Role.ORGANIZER,
            'organization_name': 'Eastern Youth Summit Nepal',
        }
    )
    if created:
        organizer.set_password('password123')
        organizer.save()
        print("  ✓ Created organizer user: organizer@eventlaya.com (pw: password123)")
    else:
        print("  ✓ Found existing organizer user")

    # 1b. Staff User for Gate Scanning
    staff_user, created = User.objects.get_or_create(
        email='staff@eventlaya.com',
        defaults={
            'username': 'staff',
            'first_name': 'Ramesh',
            'last_name': 'Adhikari',
            'phone': '+977-9812345678',
            'role': User.Role.STAFF,
            'organization_name': 'Eastern Youth Summit Nepal',
        }
    )
    if created:
        staff_user.set_password('password123')
        staff_user.save()
        print("  ✓ Created staff scanner user: staff@eventlaya.com (pw: password123)")
    else:
        print("  ✓ Found existing staff user")

    # 1c. White-label Tenant Branding for Organizer
    branding, _ = TenantBranding.objects.get_or_create(
        organizer=organizer,
        defaults={
            'subdomain': 'eastern-youth',
            'custom_domain': 'events.easternyouth.org.np',
            'cname_target': 'cname.eventlaya.com',
            'is_domain_verified': True,
            'ssl_active': True,
            'brand_name': 'Eastern Youth Summit',
            'brand_logo': 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=300',
            'primary_color': '#4F46E5',
            'accent_color': '#06B6D4',
            'support_email': 'support@easternyouth.org.np',
            'footer_text': 'Powered by Eastern Youth Summit • Dharan, Nepal',
            'remove_watermark': True,
        }
    )
    print("  ✓ Seeded white-label tenant branding")

    # 2. Dynamic Registration Form
    form, created = Form.objects.get_or_create(
        slug='eastern-tech-fest-reg',
        defaults={
            'organizer': organizer,
            'title': 'Eastern Tech Fest 2026 - Attendee Registration',
            'description': 'Register for keynotes, workshops, hackathon showcases, and tech booths in Dharan.',
            'status': Form.Status.PUBLISHED,
            'allow_multiple_submissions': False,
        }
    )
    if created:
        print("  ✓ Created dynamic registration form")
        fields = [
            # Name, email and phone are collected by every registration, so the form only holds event-specific questions
            (FormField.FieldType.TEXT, 'College / Company / Organization', False, 1, []),
            (FormField.FieldType.SELECT, 'Primary Interest Track', True, 2, ['AI & Machine Learning', 'Web3 & Fintech', 'Full Stack Development', 'Robotics & Hardware', 'Startup & Venture Pitch']),
            (FormField.FieldType.RADIO, 'Meal Preference', True, 3, ['Vegetarian', 'Non-Vegetarian']),
            (FormField.FieldType.SELECT, 'T-Shirt Size', False, 4, ['S', 'M', 'L', 'XL', 'XXL']),
            (FormField.FieldType.CHECKBOX, 'I agree to event code of conduct and safety guidelines', True, 5, ['Agreed']),
        ]
        for ftype, flabel, freq, forder, fopts in fields:
            FormField.objects.create(
                form=form,
                label=flabel,
                field_type=ftype,
                required=freq,
                order=forder,
                options=fopts
            )
        print(f"  ✓ Created {len(fields)} form fields")

    # 3. Sample Live Events
    event1, created1 = Event.objects.get_or_create(
        slug='eastern-tech-fest-2026',
        defaults={
            'organizer': organizer,
            'title': 'Eastern Nepal Tech & Innovation Summit 2026',
            'description': 'The largest technology congregation in Province 1 bringing together 800+ builders, founders, students, and engineers.',
            'banner': 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&auto=format&fit=crop&q=80',
            'location': 'Sunsari Chamber of Commerce Auditorium, Dharan-8',
            'start_date': date.today() + timedelta(days=2),
            'start_time': time(9, 30),
            'end_date': date.today() + timedelta(days=2),
            'end_time': time(17, 30),
            'capacity': 500,
            'status': Event.Status.PUBLISHED,
            'allow_registration': True,
            'registration_deadline': timezone.now() + timedelta(days=2),
            'is_paid': False,
            'ticket_price': 0.00,
            'registration_form': form,
        }
    )
    if created1:
        print("  ✓ Created main event: Eastern Nepal Tech & Innovation Summit 2026")

    event2, created2 = Event.objects.get_or_create(
        slug='biratnagar-music-awards-2026',
        defaults={
            'organizer': organizer,
            'title': 'Biratnagar Youth Music & Culture Fest 2026',
            'description': 'A grand evening celebrating eastern Nepali bands, folk fusion, live stage performances, and audience choice voting.',
            'banner': 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&auto=format&fit=crop&q=80',
            'location': 'Greenwood Resort Open Grounds, Biratnagar-4',
            'start_date': date.today() + timedelta(days=7),
            'start_time': time(16, 0),
            'end_date': date.today() + timedelta(days=7),
            'end_time': time(22, 0),
            'capacity': 1000,
            'status': Event.Status.PUBLISHED,
            'allow_registration': True,
            'is_paid': True,
            'ticket_price': 350.00,
        }
    )
    if created2:
        print("  ✓ Created music event: Biratnagar Youth Music & Culture Fest 2026")

    # 3b. Gates and staff gate assignments
    main_gate, _ = EventGate.objects.get_or_create(event=event1, name='Main North Gate', defaults={'order': 0})
    EventGate.objects.get_or_create(event=event1, name='VIP entrance', defaults={'kind': EventGate.Kind.ENTRY, 'is_vip': True, 'order': 1})
    EventGate.objects.get_or_create(event=event1, name='Exit B', defaults={'kind': EventGate.Kind.EXIT, 'order': 2})
    EventGate.objects.get_or_create(event=event2, name='Main gate', defaults={'order': 0})
    assignment, _ = StaffGateAssignment.objects.get_or_create(
        staff=staff_user,
        event=event1,
        defaults={'gate': main_gate, 'gate_name': main_gate.name, 'is_active': True}
    )
    if assignment.gate_id is None:
        assignment.gate = EventGate.objects.filter(event=event1, name__iexact=assignment.gate_name).first() or main_gate
        assignment.gate_name = assignment.gate.name
        assignment.save(update_fields=['gate', 'gate_name'])
    print(f"  ✓ Created gates and assigned staff scanner to {assignment.gate_name}")

    # 3c. Event Funding & Budget Breakdown
    EventFunding.objects.update_or_create(
        event=event1,
        defaults={
            'target_budget': 200000.00,
            'sponsorship_raised': 125000.00,
            'ticket_sales_revenue': 45000.00,
            'grants_donations': 15000.00,
            'expense_venue': 40000.00,
            'expense_catering': 35000.00,
            'expense_production': 30000.00,
            'expense_marketing': 18000.00,
            'expense_prizes_gifts': 20000.00,
            'expense_logistics': 12000.00,
        }
    )
    print("  ✓ Created event funding and budget breakdown")

    # 3d. Event Work Distribution & Operational Tasks
    tasks_data = [
        ("Setup Stage LED Backdrop & Sound Check", "Verify line-array speaker tuning, HDMI video splitters, and podium microphones with audio team.", EventTask.Status.COMPLETED, EventTask.Priority.URGENT, EventTask.Category.STAGE, "Suman Rai", timezone.now() - timedelta(hours=2)),
        ("Deploy Gate QR Scanners & Staff Briefing", "Distribute Android scanner terminals to Main North and VIP West gate crew. Review duplicate scan protocol.", EventTask.Status.IN_PROGRESS, EventTask.Priority.HIGH, EventTask.Category.GATE, "Ramesh Adhikari", timezone.now() + timedelta(hours=1)),
        ("VIP Guest Escort & Badging", "Receive keynote speakers from Biratnagar Airport, hand over speaker tags, and escort to Green Room.", EventTask.Status.TODO, EventTask.Priority.HIGH, EventTask.Category.HOSPITALITY, "Priya Sharma", timezone.now() + timedelta(hours=3)),
        ("Livestream Broadcast Setup (YouTube & Facebook)", "Test 4K multi-camera video switcher, audio line-in feed, and 50Mbps fiber uplink in Auditorium.", EventTask.Status.IN_PROGRESS, EventTask.Priority.MEDIUM, EventTask.Category.TECH, "Kiran Thapa", timezone.now() + timedelta(hours=2)),
        ("Lunch Buffet & Refreshment Quality Check", "Inspect catering hygiene, water dispenser stations, and vegan/vegetarian counter tags.", EventTask.Status.TODO, EventTask.Priority.MEDIUM, EventTask.Category.CATERING, "Bikash Gurung", timezone.now() + timedelta(hours=4)),
        ("Social Media Live Updates & Story Posts", "Photograph opening remarks, tweet live quotes, and publish Instagram stories.", EventTask.Status.TODO, EventTask.Priority.LOW, EventTask.Category.MARKETING, "Sunita Basnet", timezone.now() + timedelta(hours=2)),
    ]

    for title, desc, stat, prio, cat, assigned_name, due in tasks_data:
        EventTask.objects.get_or_create(
            event=event1,
            title=title,
            defaults={
                'organizer': event1.organizer,
                'description': desc,
                'status': stat,
                'priority': prio,
                'category': cat,
                'assigned_name': assigned_name,
                'assigned_to': staff_user if assigned_name == 'Ramesh Adhikari' else None,
                'due_time': due,
            }
        )
    print("  ✓ Seeded 6 operational work distribution tasks")
    # A general task (not tied to any event) in the organizer's workspace
    EventTask.objects.get_or_create(
        organizer=event1.organizer,
        event=None,
        title="Renew sound system rental contract",
        defaults={
            'description': "Call Everest Sound about the annual rate before the festival season.",
            'priority': EventTask.Priority.MEDIUM,
            'category': EventTask.Category.STAGE,
            'assigned_name': "Suman Rai",
            'due_date': (timezone.now() + timedelta(days=7)).date(),
        },
    )

    # 4. Generate Realistic Attendee Tickets & Gate Scan Logs
    import secrets
    sample_attendees = [
        ('Subash Dahal', 'subash.dahal@gmail.com', '+977-9842011223', EventTicket.Status.CHECKED_IN),
        ('Pooja Karki', 'pooja.karki@outlook.com', '+977-9803122334', EventTicket.Status.CHECKED_IN),
        ('Binod Shrestha', 'binod.shrestha@tech.io', '+977-9812455667', EventTicket.Status.CHECKED_IN),
        ('Anjali Rai', 'anjali.rai@yahoo.com', '+977-9860112244', EventTicket.Status.CHECKED_IN),
        ('Prashant Giri', 'prashant.giri@gmail.com', '+977-9849556677', EventTicket.Status.CHECKED_IN),
        ('Deepak Tamang', 'deepak.tamang@gmail.com', '+977-9818990011', EventTicket.Status.CHECKED_OUT),
        ('Sushila Pokharel', 'sushila.p@gmail.com', '+977-9801234567', EventTicket.Status.VALID),
        ('Bivek Chaudhary', 'bivek.ch@gmail.com', '+977-9845678901', EventTicket.Status.VALID),
        ('Manish Limbu', 'manish.limbu@gmail.com', '+977-9813243546', EventTicket.Status.VALID),
        ('Sarita Bastola', 'sarita.bastola@gmail.com', '+977-9804567890', EventTicket.Status.VALID),
    ]

    now = timezone.now()
    for idx, (name, email, phone, status_val) in enumerate(sample_attendees, start=1):
        tkt_num = f"TKT-EAST-{str(idx).zfill(4)}"
        ticket = EventTicket.objects.filter(event=event1, attendee_email=email).first()
        if not ticket:
            ticket = EventTicket.objects.create(
                event=event1,
                ticket_number=tkt_num,
                qr_token=secrets.token_hex(16),
                attendee_name=name,
                attendee_email=email,
                attendee_phone=phone,
                status=status_val,
                is_attended=(status_val in [EventTicket.Status.CHECKED_IN, EventTicket.Status.CHECKED_OUT]),
                first_check_in=(now - timedelta(minutes=45)) if status_val != EventTicket.Status.VALID else None,
                last_activity=now if status_val != EventTicket.Status.VALID else None,
            )
            if status_val != EventTicket.Status.VALID:
                # Create GateScanLog
                GateScanLog.objects.create(
                    event=event1,
                    ticket=ticket,
                    scan_type=GateScanLog.ScanType.GATE_IN,
                    result=GateScanLog.ScanResult.SUCCESS,
                    gate_name='Main North Gate',
                    gate=main_gate,
                    scanned_by=staff_user,
                    device_info='Flutter Android Scanner (Galaxy A54)',
                    scanned_at=now - timedelta(minutes=45)
                )
                if status_val == EventTicket.Status.CHECKED_OUT:
                    GateScanLog.objects.create(
                        event=event1,
                        ticket=ticket,
                        scan_type=GateScanLog.ScanType.GATE_OUT,
                        result=GateScanLog.ScanResult.SUCCESS,
                        gate_name='Main North Gate',
                        scanned_by=staff_user,
                        device_info='Flutter Android Scanner (Galaxy A54)',
                        scanned_at=now - timedelta(minutes=10)
                    )
    print("  ✓ Generated sample tickets and gate scan audits")

    # 5. Live Poll for Biratnagar Event (vote counts are real Vote rows; see seed_poll_votes)
    poll, created = Poll.objects.get_or_create(
        event=event2,
        title='Best Eastern Emerging Indie Band 2026',
        defaults={
            'description': 'Cast your live vote for the breakthrough band of the year from Eastern Nepal.',
            'status': Poll.Status.OPEN,
            'vote_mode': Poll.VoteMode.CONTACT,
        }
    )
    candidates = [
        ('The Dharan Rhythms', 'Alternative rock trio from Dharan, blending Eastern blues with rock.', 142),
        ('Itahari Folk Collective', 'Modern Sarangi and acoustic melodies infused with rock beats.', 98),
        ('Morang Sound System', 'Experimental indie-pop synthesizers from Biratnagar.', 176),
        ('Himalayan Echoes', 'Progressive fusion ensemble celebrating folk eastern folklore.', 64),
    ]
    for i, (cname, cbio, votes) in enumerate(candidates):
        cand, _ = Candidate.objects.get_or_create(
            poll=poll,
            name=cname,
            defaults={'description': cbio, 'order': i},
        )
        seed_poll_votes(cand, votes)
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
                'listing_status': 'approved',
            }
        )
    print("  ✓ Created marketplace categories & verified vendors")

    # 7. Marketplace Venue Listings in Eastern Nepal
    venues_data = [
        (
            'Royal Palace Banquet & Convention Center',
            'royal-palace-banquet-itahari',
            VenueListing.VenueType.BANQUET,
            'Itahari',
            'Main Highway Chowk, Itahari-4',
            100, 900, 60000.00,
            ['Central AC', 'Generator Power Backup', 'In-house Catering', 'Sound & Stage System', 'Valet Parking (150 Cars)', 'Bridal Suite', 'Security CCTV'],
            [
                'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=800&auto=format&fit=crop&q=80',
                'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&auto=format&fit=crop&q=80'
            ],
            'Santosh Shrestha', '+977-9852023456', 'royalpalace.itahari@gmail.com',
            'Premier luxury banquet destination in the heart of Itahari. Featuring high ceilings, chandelier illumination, carpeted flooring, and comprehensive staging.',
            'DJ music allowed until 10:30 PM. Outside catering permitted with prior sanitation approval.',
            True, True, 4.9, 38
        ),
        (
            'B.P. Koirala Memorial Auditorium',
            'bp-koirala-memorial-auditorium-dharan',
            VenueListing.VenueType.AUDITORIUM,
            'Dharan',
            'College Road, Dharan-16',
            150, 650, 35000.00,
            ['Theater Seating', 'Acoustic Wall Panels', 'Professional Stage Lighting', 'Green Rooms (x2)', 'Projector & 4K Display', 'Standby Generator'],
            [
                'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&auto=format&fit=crop&q=80',
                'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?w=800&auto=format&fit=crop&q=80'
            ],
            'Mahesh Karki', '+977-9842098765', 'auditorium.dharan@gov.np',
            'Ideal for conferences, cultural summits, awards, keynotes, and musical recitals. Features acoustic wall treatments and tiered comfortable seating.',
            'Strictly no food or drinks inside auditorium hall. Booking requires 50% advance deposit.',
            True, True, 4.8, 44
        ),
        (
            'Greenwood Lawn & Resort Ballroom',
            'greenwood-resort-biratnagar',
            VenueListing.VenueType.RESORT,
            'Biratnagar',
            'Airport Road, Biratnagar-4',
            200, 1500, 85000.00,
            ['Open Air Lush Lawn', 'Glasshouse Ballroom', 'Swimming Pool Deck', 'Ample Parking (250+ Vehicles)', 'Live BBQ Counter', 'Rooms for Guests'],
            [
                'https://images.unsplash.com/photo-1519741497674-611481863552?w=800&auto=format&fit=crop&q=80',
                'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&auto=format&fit=crop&q=80'
            ],
            'Sanjay Agrawal', '+977-021-460112', 'info@greenwoodresort.np',
            'Sprawling 3-acre resort complex suitable for grand destination weddings, youth festivals, corporate retreats, and open air concert gatherings.',
            'Fireworks require local administration clearance. Sound restrictions apply after 11 PM.',
            True, True, 4.9, 52
        ),
        (
            'Hotel Eastern Star Grand Ballroom',
            'hotel-eastern-star-biratnagar',
            VenueListing.VenueType.HOTEL,
            'Biratnagar',
            'Traffic Chowk, Biratnagar-3',
            50, 400, 45000.00,
            ['Multi-Zone AC', 'Executive Boardroom', 'Wi-Fi 6 Coverage', 'Full In-House Bar & Kitchen', 'Elevator Access', 'Sound Technician on Duty'],
            [
                'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?w=800&auto=format&fit=crop&q=80'
            ],
            'Anita Basnet', '+977-021-471234', 'reservations@easternstar.com.np',
            'Modern 4-star hotel banquet hall equipped with executive amenities, top-tier audio equipment, and professional catering staff.',
            'In-house catering mandatory. Corkage fee applies to external beverages.',
            True, False, 4.7, 26
        ),
    ]

    for name, slug, vtype, city, addr, cmin, cmax, price, amens, imgs, cpers, cphone, cmail, desc, rules, ver, feat, rat, rcnt in venues_data:
        venue, _ = VenueListing.objects.get_or_create(
            slug=slug,
            defaults={
                'owner': organizer,
                'name': name,
                'venue_type': vtype,
                'city': city,
                'address': addr,
                'capacity_min': cmin,
                'capacity_max': cmax,
                'price_per_day': price,
                'amenities': amens,
                'images': imgs,
                'contact_person': cpers,
                'contact_phone': cphone,
                'contact_email': cmail,
                'description': desc,
                'rules_policy': rules,
                'is_verified': ver,
                'is_featured': feat,
                'rating': rat,
                'review_count': rcnt,
                'listing_status': 'approved',
            }
        )

        # Seed sample inquiry
        VenueInquiry.objects.get_or_create(
            venue=venue,
            sender_name='Ganesh Thapa',
            defaults={
                'sender_email': 'ganesh.thapa@gmail.com',
                'sender_phone': '+977-9842551122',
                'event_type': 'Wedding Reception',
                'event_date': date.today() + timedelta(days=20),
                'guest_count': 350,
                'budget_range': 'NPR 1,50,000 - 2,50,000',
                'message': 'Looking for hall availability for evening reception with vegetarian buffet and stage setup.',
                'status': VenueInquiry.Status.PENDING,
            }
        )
    seed_venue_spaces()
    print("  ✓ Created venue listings, Royal Palace halls & sample venue inquiries")

    print("🎉 All sample data populated successfully!")

def seed_white_label_requests():
    """Agent P: one pending white-label request from the organizer demo account (idempotent).

    White-label is approved by a platform admin, so the organizer's branding keeps no custom
    domain or hidden watermark until that approval happens.
    """
    from apps.platform.models import WhiteLabelRequest

    organizer = User.objects.filter(email='organizer@eventlaya.com').first()
    if not organizer:
        return
    if not WhiteLabelRequest.objects.filter(organizer=organizer).exists():
        WhiteLabelRequest.objects.create(
            organizer=organizer,
            requested_domain='events.easternyouth.org.np',
            brand_name='Eastern Youth Summit',
            logo_url='https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=300',
            primary_color='#1D4ED8',
            accent_color='#F59E0B',
            remove_watermark=True,
            note='We run the Eastern Youth Summit every year and want attendees to register on our own domain.',
        )
    if not WhiteLabelRequest.approved_for(organizer):
        TenantBranding.objects.filter(organizer=organizer).update(
            custom_domain=None, is_domain_verified=False, ssl_active=False, remove_watermark=False,
        )
    print("  ✓ Seeded a pending white-label request from organizer@eventlaya.com")


def seed_marketplace_accounts():
    """Agent M: vendor demo account and an organizer waiting for marketplace access (idempotent).

    vendor@eventlaya.com   – sound & light company: an approved service profile, the Royal Palace
                             venue (with its halls and inquiries) and one venue waiting for review.
    palace@eventlaya.com   – an event company that also rents halls; its marketplace access request
                             is waiting for a platform admin.
    """
    from apps.marketplace.models import ListingStatus, MarketplaceAccessRequest

    vendor, created = User.objects.get_or_create(
        email='vendor@eventlaya.com',
        defaults={
            'username': 'vendor',
            'first_name': 'Bikash',
            'last_name': 'Rai',
            'phone': '+977-9842033445',
            'role': User.Role.VENDOR,
            'marketplace_access': User.MarketplaceAccess.APPROVED,
            'organization_name': 'Himalayan Waves Sound & Light',
        }
    )
    if created:
        vendor.set_password('password123')
        vendor.save()

    # Approved service profile and a live venue with halls and inquiries.
    VendorProfile.objects.filter(business_name='Himalayan Waves Sound & Light').update(
        user=vendor, listing_status=ListingStatus.APPROVED,
    )
    royal = VenueListing.objects.filter(slug='royal-palace-banquet-itahari').first()
    if royal:
        if royal.owner_id != vendor.id:
            royal.owner = vendor
            royal.save(update_fields=['owner'])
        halls = {s.name: s for s in royal.spaces.all()}
        for sender, email, phone, event_type, days, guests, hall, status in [
            ('Sunita Limbu', 'sunita.limbu@gmail.com', '+977-9811223344', 'Engagement ceremony', 34, 250,
             'Kanchenjunga Hall', VenueInquiry.Status.CONTACTED),
            ('Dharan Rotary Club', 'events@dharanrotary.org.np', '+977-9852077001', 'Annual charity gala', 52, 500,
             'Sagarmatha Hall', VenueInquiry.Status.PENDING),
            ('Prakash Karki', 'prakash.karki@yahoo.com', '+977-9804455667', 'Corporate seminar', 12, 120,
             'Makalu Hall', VenueInquiry.Status.BOOKED),
        ]:
            VenueInquiry.objects.get_or_create(
                venue=royal, sender_name=sender,
                defaults={
                    'space': halls.get(hall),
                    'sender_email': email,
                    'sender_phone': phone,
                    'event_type': event_type,
                    'event_date': date.today() + timedelta(days=days),
                    'guest_count': guests,
                    'budget_range': 'NPR 1,00,000 - 3,00,000',
                    'message': f'We are planning our {event_type.lower()} for about {guests} guests. Is {hall} free on this date?',
                    'status': status,
                }
            )

    VenueListing.objects.get_or_create(
        slug='koshi-riverside-party-lawn-itahari',
        defaults={
            'owner': vendor,
            'name': 'Koshi Riverside Party Lawn',
            'venue_type': VenueListing.VenueType.RESORT,
            'city': 'Itahari',
            'address': 'Koshi Highway, Itahari-6',
            'capacity_min': 100,
            'capacity_max': 700,
            'price_per_day': 55000,
            'amenities': ['Open lawn', 'Generator backup', 'Parking for 80 cars', 'Stage & sound on request'],
            'images': ['https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=800&auto=format&fit=crop&q=80'],
            'contact_person': 'Bikash Rai',
            'contact_phone': '+977-9842033445',
            'contact_email': 'info@himalayanwaves.com',
            'description': 'Riverside lawn for weddings, concerts and college fests, with our own sound and lighting crew on site.',
            'rules_policy': 'Music until 10 PM. 30% advance to confirm the date.',
            'listing_status': ListingStatus.PENDING,
        }
    )
    print("  ✓ Seeded vendor demo account: vendor@eventlaya.com (pw: password123)")

    palace, created = User.objects.get_or_create(
        email='palace@eventlaya.com',
        defaults={
            'username': 'palace',
            'first_name': 'Sarita',
            'last_name': 'Gurung',
            'phone': '+977-9817001122',
            'role': User.Role.ORGANIZER,
            'organization_name': 'Biratnagar Party Palace',
        }
    )
    if created:
        palace.set_password('password123')
        palace.save()
    if not MarketplaceAccessRequest.objects.filter(user=palace).exists():
        MarketplaceAccessRequest.objects.create(
            user=palace,
            business_name='Biratnagar Party Palace',
            business_type=MarketplaceAccessRequest.BusinessType.VENUE,
            city='Biratnagar',
            phone='+977-9817001122',
            note='We organise weddings ourselves and also rent our two banquet halls to other organisers.',
        )
        palace.marketplace_access = User.MarketplaceAccess.PENDING
        palace.save(update_fields=['marketplace_access'])
    print("  ✓ Seeded palace@eventlaya.com with a pending marketplace access request (pw: password123)")


def seed_billing():
    """Agent P: demo subscriptions, recorded payments and one upgrade request (idempotent)."""
    from apps.platform.billing import add_months, ensure_subscriptions
    from apps.platform.models import Payment, Plan, PlanChangeRequest, Subscription

    ensure_subscriptions()
    admin = User.objects.filter(email='superadmin@eventlaya.com').first()
    now = timezone.now()
    plans = {p.code: p for p in Plan.objects.all()}

    organizer = User.objects.filter(email='organizer@eventlaya.com').first()
    if organizer and not Payment.objects.filter(organization=organizer).exists():
        # Event Pro, paid monthly for the last three months; renews in a few days
        sub = Subscription.objects.get(organization=organizer)
        start = add_months(now, -2) - timedelta(days=3)
        for i, (method, ref) in enumerate([('esewa', 'ESW-58211'), ('khalti', 'KHL-77310'), ('esewa', 'ESW-60457')]):
            Payment.objects.create(
                organization=organizer, subscription=sub, plan=plans['event_pro'], billing_cycle='monthly',
                amount=1499, method=method, reference=ref, months_covered=1,
                paid_at=add_months(start, i), recorded_by=admin,
            )
        sub.plan = plans['event_pro']
        sub.billing_cycle = 'monthly'
        sub.status = Subscription.Status.ACTIVE
        sub.current_period_start = add_months(start, 2)
        sub.current_period_end = add_months(start, 3)
        sub.save()

    palace = User.objects.filter(email='palace@eventlaya.com').first()
    if palace and not Payment.objects.filter(organization=palace).exists():
        sub = Subscription.objects.get(organization=palace)
        paid_at = now - timedelta(days=40)
        Payment.objects.create(
            organization=palace, subscription=sub, plan=plans['business'], billing_cycle='yearly',
            amount=38390, method='bank', reference='NIC-ASIA-220145', months_covered=12, paid_at=paid_at,
            recorded_by=admin, note='Paid by cheque deposit at the Biratnagar branch.',
        )
        sub.plan = plans['business']
        sub.billing_cycle = 'yearly'
        sub.status = Subscription.Status.ACTIVE
        sub.current_period_start = paid_at
        sub.current_period_end = add_months(paid_at, 12)
        sub.save()

    if organizer and not PlanChangeRequest.objects.filter(organization=organizer).exists():
        PlanChangeRequest.objects.create(
            organization=organizer, requested_plan=plans['business'], billing_cycle='yearly',
            note='Fest season is coming and we need live voting and several events at once.',
        )
    print("  ✓ Seeded subscriptions, payments and an upgrade request")


def generate_event_banner(event):
    """Abstract brand-colour banner (no text) for an event, saved under media/events/banners/. Idempotent."""
    import random
    from pathlib import Path
    from django.conf import settings
    from PIL import Image, ImageDraw

    rel = f'events/banners/{event.slug}.png'
    path = Path(settings.MEDIA_ROOT) / rel
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        rng = random.Random(event.slug)
        W, H = 1600, 700
        base = Image.new('RGB', (W, H), (250, 248, 251))  # ink-50
        layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        brand, marigold, blush = (194, 33, 90), (227, 148, 0), (243, 214, 226)
        # Large soft discs
        for colour, alpha, r in ((blush, 255, 420), (brand, 230, 300), (marigold, 220, 210), (brand, 90, 520)):
            cx, cy = rng.randint(200, W - 100), rng.randint(-100, H + 100)
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=colour + (alpha,))
        # Rings and arcs
        for _ in range(4):
            r = rng.randint(80, 220)
            cx, cy = rng.randint(0, W), rng.randint(0, H)
            d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(marigold if rng.random() > .5 else brand) + (200,), width=rng.randint(10, 22))
        # Ticket-like rounded bars
        for _ in range(5):
            x, y = rng.randint(0, W - 300), rng.randint(0, H - 60)
            w = rng.randint(160, 360)
            d.rounded_rectangle((x, y, x + w, y + 46), radius=23, fill=(255, 255, 255, 170))
        # Dot grid
        ox, oy = rng.randint(60, 400), rng.randint(60, 300)
        for i in range(8):
            for j in range(5):
                d.ellipse((ox + i * 34, oy + j * 34, ox + i * 34 + 8, oy + j * 34 + 8), fill=brand + (150,))
        base.paste(layer, (0, 0), layer)
        base.save(path, optimize=True)
    if event.banner.name != rel:
        event.banner.name = rel
        event.save(update_fields=['banner'])
    return rel


def seed_event_pages():
    """Public event page content for the demo events (tagline, highlights, agenda, speakers, FAQs, banner)."""
    from apps.events.models import EventAgendaItem, EventSpeaker, EventFAQ

    etf = Event.objects.filter(slug='eastern-tech-fest-2026').first()
    if etf:
        etf.tagline = 'Two days of talks, robots and a 24-hour hackathon in the heart of Dharan'
        etf.category = Event.Category.HACKATHON
        etf.highlights = [
            '24-hour hackathon with NPR 3,00,000 in prizes',
            'Keynotes from founders building in Eastern Nepal',
            'Robotics and IoT exhibition by campus clubs',
            'Free lunch, snacks and hackathon T-shirt',
        ]
        etf.contact_email = 'hello@easterntechfest.com'
        etf.contact_phone = '+977 25-520123'
        etf.map_query = 'Purwanchal Campus, Dharan, Nepal'
        etf.save()
        d1 = etf.start_date
        d2 = etf.end_date or etf.start_date
        if not etf.agenda.exists():
            items = [
                (d1, time(9, 0), time(9, 45), 'Registration and breakfast', 'Main lobby', '', 'Pick up your badge and T-shirt. Show your QR pass at the gate.'),
                (d1, time(10, 0), time(10, 45), 'Opening keynote: Building tech in Province 1', 'Main auditorium', 'Bikash Shrestha', ''),
                (d1, time(11, 0), time(12, 0), 'Panel: From campus project to startup', 'Main auditorium', 'Anjali Rai, Sujan Limbu', ''),
                (d1, time(13, 0), time(13, 30), 'Hackathon kickoff and team formation', 'Hack hall', 'Sujan Limbu', 'Problem statements are revealed. Teams of 2 to 4.'),
                (d1, time(13, 30), None, 'Hacking begins', 'Hack hall', '', 'Mentors are on the floor all night.'),
                (d1, time(15, 0), time(16, 0), 'Workshop: Shipping AI features responsibly', 'Lab 2', 'Pooja Karki', ''),
                (d2, time(13, 30), time(15, 30), 'Final demos', 'Main auditorium', '', 'Each team gets 4 minutes to demo.'),
                (d2, time(16, 30), time(18, 0), 'Awards and closing', 'Main auditorium', 'Bikash Shrestha', ''),
            ]
            EventAgendaItem.objects.bulk_create([
                EventAgendaItem(event=etf, day=day, start_time=s, end_time=e, title=t, location=loc, speaker_names=sp, description=desc, order=i)
                for i, (day, s, e, t, loc, sp, desc) in enumerate(items)
            ])
        if not etf.speakers.exists():
            speakers = [
                ('Bikash Shrestha', 'Founder and CEO', 'Koshi Cloud', 'Bikash has built software for banks and co-ops across Nepal and mentors early founders in Dharan and Itahari.'),
                ('Anjali Rai', 'Head of Engineering', 'Himal Fintech', 'Anjali leads a 40-person engineering team and runs a free coding bootcamp for women in Sunsari.'),
                ('Sujan Limbu', 'Hackathon lead', 'Eastern Tech Innovators Club', 'Sujan has organised student hackathons since 2019 and will run the 24-hour challenge.'),
                ('Pooja Karki', 'Machine learning engineer', 'Daraz Nepal', 'Pooja works on search and recommendations, and teaches practical AI at Purwanchal Campus.'),
            ]
            EventSpeaker.objects.bulk_create([
                EventSpeaker(event=etf, name=n, role=r, organization=o, bio=b, order=i) for i, (n, r, o, b) in enumerate(speakers)
            ])
        if not etf.faqs.exists():
            faqs = [
                ('Is the event free?', 'Yes. Registration is free, and lunch and snacks are included for registered attendees.'),
                ('Who can join the hackathon?', 'Any student or working professional. Teams have 2 to 4 people, and you can form a team on the day.'),
                ('What should I bring?', 'Your laptop, charger and your QR pass (on your phone or printed). Power strips and Wi-Fi are provided.'),
                ('Is overnight accommodation available?', 'Limited hostel beds are available. Choose "Yes (Hostel)" in the registration form and we will confirm by email.'),
                ('How do I get to Purwanchal Campus?', 'The campus is a 10-minute walk from Dharan Bhanu Chowk. Local buses from Itahari stop at the campus gate.'),
            ]
            EventFAQ.objects.bulk_create([EventFAQ(event=etf, question=q, answer=a, order=i) for i, (q, a) in enumerate(faqs)])
        generate_event_banner(etf)

    music = Event.objects.filter(slug='biratnagar-music-awards-2026').first()
    if music:
        if not music.tagline:
            music.tagline = 'A night of live bands, folk fusion and the youth music awards'
            music.category = Event.Category.CONCERT
            music.highlights = ['Six live bands on two stages', 'Folk fusion showcase', 'Youth music awards ceremony']
            music.save()
        if not music.faqs.exists():
            EventFAQ.objects.bulk_create([
                EventFAQ(event=music, question='Is there an age limit?', answer='Everyone is welcome. Under-12s must come with an adult.', order=0),
                EventFAQ(event=music, question='Can I re-enter after leaving?', answer='Yes. Scan your pass at the exit and again when you come back.', order=1),
            ])
        generate_event_banner(music)
    print("  ✓ Seeded event page content and banners")



def seed_poll_votes(candidate, target, spread_minutes=0):
    """Top a candidate up to `target` anonymous demo votes (idempotent). Optionally spread them over the last N minutes."""
    import hashlib
    import random
    import uuid as _uuid
    missing = target - candidate.votes.count()
    if missing <= 0:
        return
    now = timezone.now()
    Vote.objects.bulk_create([
        Vote(
            poll=candidate.poll,
            candidate=candidate,
            voter_identifier=hashlib.sha256(f'demo:{_uuid.uuid4()}'.encode()).hexdigest(),
            voted_at=now - timedelta(minutes=random.uniform(0, spread_minutes)) if spread_minutes else candidate.poll.created_at,
        )
        for _ in range(missing)
    ])


def seed_voting():
    """Two polls for Eastern Tech Fest: an open project vote with live demo votes, and a scheduled crowd favourite."""
    event = Event.objects.filter(slug='eastern-tech-fest-2026').first() or Event.objects.filter(title__startswith='Eastern Tech Fest').first()
    if not event:
        print("  ! Eastern Tech Fest not found; skipped voting seed")
        return
    now = timezone.now()
    hack, _ = Poll.objects.get_or_create(
        event=event,
        title='Best hackathon project',
        defaults={
            'description': 'Pick the team whose 24-hour build impressed you most. One vote per ticket.',
            'status': Poll.Status.OPEN,
            'vote_mode': Poll.VoteMode.TICKET,
            'results_visibility': Poll.ResultsVisibility.LIVE,
            'closes_at': now + timedelta(days=2),
            'order': 0,
        },
    )
    teams = [
        ('Team Sagarmatha', 'Purwanchal Campus', 'AI triage assistant for rural health posts that works offline.', 34),
        ('Koshi Coders', 'Itahari International College', 'Flood early-warning SMS network built on river sensor data.', 27),
        ('Byte Brigade', 'Mahendra Morang Campus', 'Bus tracking for Biratnagar city routes with live seat counts.', 21),
        ('Code Kanchenjunga', 'Dharan Engineering College', 'Tea-garden wage ledger that workers can check from any phone.', 15),
    ]
    cands = []
    for i, (name, subtitle, desc, _votes) in enumerate(teams):
        cand, _ = Candidate.objects.get_or_create(
            poll=hack, name=name, defaults={'subtitle': subtitle, 'description': desc, 'order': i},
        )
        cands.append(cand)
    # A ticket poll can only hold ticket votes: real attendees' tickets vote, leaving the last few free to try it out.
    import hashlib
    import random
    Vote.objects.filter(poll=hack, ticket__isnull=True).delete()
    pattern = [0, 1, 0, 2, 0, 1, 3, 0, 1, 2, 0, 3, 1]
    tickets = list(event.tickets.exclude(status=EventTicket.Status.CANCELLED).order_by('created_at', 'ticket_number'))
    rng = random.Random(7)
    for ticket, team in zip(tickets[:-3], pattern * 10):
        voter = hashlib.sha256(f'ticket:{ticket.id}'.encode('utf-8')).hexdigest()
        if not Vote.objects.filter(poll=hack, voter_identifier=voter).exists():
            Vote.objects.create(poll=hack, candidate=cands[team], ticket=ticket, voter_identifier=voter,
                                voted_at=now - timedelta(minutes=rng.uniform(2, 170)))

    band, _ = Poll.objects.get_or_create(
        event=event,
        title='Crowd favourite band',
        defaults={
            'description': 'Vote for the band that got the crowd moving at the closing concert.',
            'status': Poll.Status.SCHEDULED,
            'opens_at': now + timedelta(days=1, hours=2),
            'closes_at': now + timedelta(days=1, hours=5),
            'vote_mode': Poll.VoteMode.CONTACT,
            'allow_multiple': True,
            'max_choices': 2,
            'results_visibility': Poll.ResultsVisibility.AFTER_CLOSE,
            'order': 1,
        },
    )
    for i, (name, subtitle) in enumerate([
        ('Nepathya Tribute', 'Dharan'),
        ('Rhythm of Koshi', 'Biratnagar'),
        ('The Itahari Strings', 'Itahari'),
    ]):
        Candidate.objects.get_or_create(poll=band, name=name, defaults={'subtitle': subtitle, 'order': i})
    print("  ✓ Seeded Eastern Tech Fest polls")


if __name__ == '__main__':
    populate()
    seed_marketplace_accounts()
    seed_white_label_requests()
    seed_billing()
    seed_event_pages()
    seed_voting()
