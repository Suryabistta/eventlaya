"""Starter articles in seed_posts/*.md (YAML front matter + Markdown body), loaded by `manage.py seed_blog`."""
from datetime import timedelta
from pathlib import Path

import yaml
from django.utils import timezone

SEED_DIR = Path(__file__).resolve().parent / 'seed_posts'


def parse_seed_file(path):
    text = Path(path).read_text(encoding='utf-8')
    if not text.startswith('---'):
        raise ValueError(f'{path}: missing front matter')
    _, front, body = text.split('---', 2)
    meta = yaml.safe_load(front) or {}
    faq = [{'q': str(i.get('q', '')).strip(), 'a': str(i.get('a', '')).strip()} for i in meta.get('faq') or []]
    return {
        'title': meta['title'].strip(),
        'slug': meta['slug'].strip(),
        'seo_title': (meta.get('seo_title') or '').strip(),
        'excerpt': (meta.get('excerpt') or '').strip(),
        'focus_keyword': (meta.get('focus_keyword') or '').strip(),
        'category': (meta.get('category') or 'guides').strip(),
        'tags': [str(t).strip() for t in meta.get('tags') or []],
        'cities': [str(c).strip() for c in meta.get('cities') or []],
        'faq': [f for f in faq if f['q'] and f['a']],
        'language': (meta.get('language') or 'en').strip(),
        'translation_of': (meta.get('translation_of') or '').strip(),
        'body': body.strip() + '\n',
    }


def seed_posts(update=False, stdout=None):
    """Create the starter posts that don't exist yet (by slug). update=True rewrites existing ones too.

    Returns (created, updated, skipped). Posts are published under "Eventlaya team", the first file newest.
    """
    from .models import DEFAULT_AUTHOR, Post
    files = sorted(SEED_DIR.glob('*.md'))
    now = timezone.now()
    created = updated = skipped = 0
    for index, path in enumerate(files):
        data = parse_seed_file(path)
        post = Post.objects.filter(slug=data['slug']).first()
        if post is not None and not update:
            skipped += 1
            continue
        if post is None:
            post = Post(slug=data['slug'], status=Post.Status.PUBLISHED, author_name=DEFAULT_AUTHOR,
                        published_at=now - timedelta(minutes=index))
            created += 1
        else:
            updated += 1
        for field, value in data.items():
            setattr(post, field, value)
        post.save()
        if stdout:
            stdout.write(f'  {post.slug}')
    return created, updated, skipped
