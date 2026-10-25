import os
import django
from datetime import date, time, timedelta

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from django.utils import timezone
from apps.accounts.models import PlatformModule, RoleModulePermission, TenantBranding
from apps.events.models import Event, EventTicket, GateScanLog, StaffGateAssignment, EventFunding, EventTask
from apps.dynamic_forms.models import Form, FormField, FormResponse, FormAnswer
from apps.voting.models import Poll, Candidate, Vote
from apps.marketplace.models import VendorCategory, VendorProfile, VenueListing, VenueInquiry

User = get_user_model()

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
            (FormField.FieldType.TEXT, 'Full Name', True, 1, []),
            (FormField.FieldType.EMAIL, 'Email Address', True, 2, []),
            (FormField.FieldType.PHONE, 'Mobile / WhatsApp Number', True, 3, []),
            (FormField.FieldType.TEXT, 'College / Company / Organization', False, 4, []),
            (FormField.FieldType.SELECT, 'Primary Interest Track', True, 5, ['AI & Machine Learning', 'Web3 & Fintech', 'Full Stack Development', 'Robotics & Hardware', 'Startup & Venture Pitch']),
            (FormField.FieldType.RADIO, 'Meal Preference', True, 6, ['Vegetarian', 'Non-Vegetarian']),
            (FormField.FieldType.SELECT, 'T-Shirt Size', False, 7, ['S', 'M', 'L', 'XL', 'XXL']),
            (FormField.FieldType.CHECKBOX, 'I agree to event code of conduct and safety guidelines', True, 8, ['Agreed']),
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
        print("  ✓ Created 8 form fields")

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

    # 3b. Staff Gate Assignments
    StaffGateAssignment.objects.get_or_create(
        staff=staff_user,
        event=event1,
        defaults={'gate_name': 'Main North Gate', 'is_active': True}
    )
    print("  ✓ Assigned staff scanner to Main North Gate")

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

    # 5. Live Poll for Biratnagar Event
    poll, created = Poll.objects.get_or_create(
        event=event2,
        title='Best Eastern Emerging Indie Band 2026',
        defaults={
            'description': 'Cast your live vote for the breakthrough band of the year from Eastern Nepal.',
            'is_active': True,
            'require_ticket': False,
        }
    )
    candidates = [
        ('The Dharan Rhythms', 'Alternative rock trio from Dharan, blending Eastern blues with rock.', 142),
        ('Itahari Folk Collective', 'Modern Sarangi and acoustic melodies infused with rock beats.', 98),
        ('Morang Sound System', 'Experimental indie-pop synthesizers from Biratnagar.', 176),
        ('Himalayan Echoes', 'Progressive fusion ensemble celebrating folk eastern folklore.', 64),
    ]
    for cname, cbio, votes in candidates:
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
    print("  ✓ Created venue listings & sample venue inquiries")

    print("🎉 All sample data populated successfully!")

if __name__ == '__main__':
    populate()
