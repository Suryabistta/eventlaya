"""Link previews and search metadata for contest pages, served by apps.seo:
/e/<event>/vote/<contest> and /e/<event>/vote/<contest>/c/<number-or-slug>.

Shared contestant links ("Vote for #07 …") are how contests spread on WhatsApp and Facebook, so they carry the
contestant's own title, description and photo.
"""
from django.http import Http404
from rest_framework.exceptions import APIException

from apps.seo.pages import PageMeta, register


def _generic(ctx):
    # Quick polls, hidden or switched-off contests: the plain site preview, kept out of search results
    return PageMeta(title=ctx.site_name, robots='noindex,nofollow', site_name=ctx.site_name, canonical=None)


@register(r'^/e/(?P<slug>[^/]+)/vote/(?P<ref>[^/]+)(?:/c/(?P<cref>[^/]+))?$', hosts='both')
def contest_page(ctx, slug, ref, cref=None):
    from .public_contest_views import absolute, find_contestant, get_public_contest
    try:
        poll = get_public_contest(ctx.request, slug, ref)
    except (Http404, APIException):
        return _generic(ctx)
    base = f'/e/{poll.event.slug}/vote/{poll.slug or poll.id}'
    if cref:
        c = find_contestant(poll, cref)
        if c is None:
            return None
        num = poll.format_number(c.number)
        name = f'{num} {c.name}'.strip()
        path = f'{base}/c/{c.number if c.number is not None else c.slug}'
        return PageMeta(
            title=f'Vote for {name} · {poll.title}',
            og_title=f'Vote for {name}',
            description=(c.description or c.subtitle or f'{c.name} is competing in {poll.title}. Tap to vote.')[:200],
            canonical=ctx.url(path),
            image=absolute(ctx.request, c.photo_url or poll.cover_url) or None,
            image_alt=c.name,
            site_name=ctx.site_name,
        )
    banner = poll.event.banner.url if poll.event.banner else ''
    return PageMeta(
        title=f'{poll.title} · {poll.event.title}',
        og_title=poll.title,
        description=(poll.description or f'Vote in {poll.title} at {poll.event.title}.')[:200],
        canonical=ctx.url(base),
        image=absolute(ctx.request, poll.cover_url or banner) or None,
        image_alt=poll.title,
        site_name=ctx.site_name,
    )
