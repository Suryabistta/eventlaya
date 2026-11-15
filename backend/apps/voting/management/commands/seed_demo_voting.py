"""Demo voting data for trying the voting pages by hand (local / staging only).

    python manage.py seed_demo_voting          # create (or refresh) the demo
    python manage.py seed_demo_voting --remove # delete everything it made

Makes a demo organizer (demo-voting@eventlaya.local / demo-12345), a published pageant event and three contests:
a live one (open, free device votes, 8 contestants with generated portraits and some votes), an upcoming one and a
past one, so /voting shows something in Live, Upcoming and Past. Everything is tagged "Demo" in its name.
"""
import random
from datetime import timedelta
from io import BytesIO

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand
from django.utils import timezone

EMAIL = 'demo-voting@eventlaya.local'
PASSWORD = 'demo-12345'
EVENT_SLUG = 'demo-miss-eventlaya-2026'
NAMES = ['Asha Rai', 'Bina Limbu', 'Chandra Gurung', 'Dipika Thapa', 'Esha Magar', 'Funu Shrestha', 'Gita Tamang', 'Hema Karki']
CITIES = ['Dharan', 'Itahari', 'Biratnagar', 'Damak', 'Ilam', 'Dhankuta', 'Inaruwa', 'Birtamod']
COLORS = [(244, 194, 214), (214, 200, 244), (186, 226, 226), (248, 216, 168), (204, 228, 196), (250, 204, 190), (196, 218, 244), (240, 220, 200)]


def portrait(name, color):
    """A simple 600x750 portrait: soft background, shoulders, head and initials. Saved under media/demo/voting/."""
    from PIL import Image, ImageDraw, ImageFont
    w, h = 600, 750
    img = Image.new('RGB', (w, h), color)
    d = ImageDraw.Draw(img)
    for y in range(h):  # gentle vertical fade
        a = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(c * (1 - a * 0.25)) for c in color))
    d.ellipse([90, 520, 510, 900], fill=(178, 34, 86))  # shoulders
    d.ellipse([200, 200, 400, 440], fill=(222, 170, 130))  # face
    d.pieslice([185, 160, 415, 460], 180, 360, fill=(40, 28, 30))  # hair
    initials = ''.join(p[0] for p in name.split()[:2]).upper()
    try:
        font = ImageFont.truetype('DejaVuSans-Bold.ttf', 64)
    except OSError:
        font = ImageFont.load_default()
    d.text((w / 2, 640), initials, fill='white', anchor='mm', font=font)
    buf = BytesIO()
    img.save(buf, 'JPEG', quality=85)
    slug = name.lower().replace(' ', '-')
    path = f'demo/voting/{slug}.jpg'
    if default_storage.exists(path):
        default_storage.delete(path)
    return default_storage.url(default_storage.save(path, ContentFile(buf.getvalue())))


class Command(BaseCommand):
    help = 'Create (or remove) demo voting data for manual testing.'

    def add_arguments(self, parser):
        parser.add_argument('--remove', action='store_true', help='Delete the demo organizer, event and contests')

    def handle(self, *args, remove=False, **opts):
        from django.contrib.auth import get_user_model
        from apps.events.models import Event
        from apps.voting.models import Candidate, Poll, Vote, hash_voter, nepal_date

        User = get_user_model()
        if remove:
            Event.objects.filter(slug=EVENT_SLUG).delete()  # contests, contestants and votes go with it
            User.objects.filter(email=EMAIL).delete()
            self.stdout.write(self.style.SUCCESS('Demo voting data removed.'))
            return

        user, _ = User.objects.get_or_create(email=EMAIL, defaults={'username': 'demo-voting', 'role': 'organizer'})
        user.organization_name = 'Eventlaya Demo Club'
        user.email_verified = True
        user.set_password(PASSWORD)
        user.save()

        now = timezone.now()
        # Kept across re-runs (same id), so pages and the organizer's current event stay valid; only the contests are rebuilt
        event, _ = Event.objects.update_or_create(slug=EVENT_SLUG, defaults=dict(
            organizer=user, title='Demo · Miss Eventlaya 2026', location='City Hall, Dharan',
            description='Demo pageant for trying public voting. Not a real event.',
            start_date=(now + timedelta(days=30)).date(), status=Event.Status.PUBLISHED,
            tickets_enabled=False, applications_enabled=True, applications_close=now - timedelta(days=1),
        ))
        Poll.objects.filter(event=event).delete()

        def contest(title, slug, status, opens, closes, n, votes):
            poll = Poll.objects.create(
                event=event, kind=Poll.Kind.CONTEST, title=title, slug=slug, status=status, opens_at=opens, closes_at=closes,
                vote_mode=Poll.VoteMode.OPEN, results_visibility=Poll.ResultsVisibility.LIVE, votes_per_day=5, votes_per_voter=None,
                allow_split=True, max_votes_per_submit=5, captcha_enabled=False,
                description='Demo contest. Vote as often as the daily limit allows; nothing here is real.',
            )
            rnd = random.Random(slug)
            for i, name in enumerate(NAMES[:n]):
                c = Candidate.objects.create(
                    poll=poll, name=name, number=i + 1, order=i, slug=name.lower().replace(' ', '-'),
                    subtitle=CITIES[i], description=f'{name} from {CITIES[i]}. Demo contestant.',
                    photo_url=portrait(name, COLORS[i % len(COLORS)]),
                )
                for j in range(rnd.randint(votes // 3, votes) if votes else 0):
                    Vote.objects.create(poll=poll, candidate=c, voter_identifier=hash_voter(f'demo:{slug}:{i}:{j}'),
                                        quantity=1, method='open', nepal_date=nepal_date(now))
            return poll

        contest('Demo · Miss Eventlaya 2026', 'demo-live', Poll.Status.OPEN, now - timedelta(hours=1), now + timedelta(days=3), 8, 40)
        contest('Demo · Talent Hunt (upcoming)', 'demo-upcoming', Poll.Status.SCHEDULED, now + timedelta(days=2), now + timedelta(days=9), 6, 0)
        contest('Demo · Dance Star (past)', 'demo-past', Poll.Status.CLOSED, now - timedelta(days=10), now - timedelta(days=2), 5, 30)

        self.stdout.write(self.style.SUCCESS(
            f'Demo voting ready.\n  Public: /voting  ·  /e/{EVENT_SLUG}/vote/demo-live\n'
            f'  Organizer login: {EMAIL} / {PASSWORD}\n  Remove with: python manage.py seed_demo_voting --remove'))
