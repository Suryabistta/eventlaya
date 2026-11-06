from django.core.management.base import BaseCommand

from apps.blog.seed import seed_posts


class Command(BaseCommand):
    help = 'Publish the starter blog articles (apps/blog/seed_posts) that are not in the database yet.'

    def add_arguments(self, parser):
        parser.add_argument('--update', action='store_true',
                            help='Also overwrite existing posts with the same slug (loses edits made in the editor).')

    def handle(self, *args, update=False, **options):
        created, updated, skipped = seed_posts(update=update)
        self.stdout.write(f'Blog seed: {created} created, {updated} updated, {skipped} already there')
