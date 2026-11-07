"""Sub-events (module `sub_events`): a main event with child events, one level deep."""
from apps.accounts.modules import module_enabled


def sub_events_on(event_or_user):
    """Whether sub-events are switched on for this event's organizer (or this user)."""
    user = getattr(event_or_user, 'organizer', event_or_user)
    return module_enabled('sub_events', user)


def display_title(event):
    """"Dharan Film Festival › Workshop" for a sub-event, else the title. Used on passes and in My tickets."""
    if event.parent_id and sub_events_on(event):
        return f'{event.parent.title} › {event.title}'
    return event.title


def sub_event_cards(event):
    """Public summaries of a main event's published sub-events, soonest first."""
    from .models import Event
    from .views import PUBLIC_EVENT_STATUSES
    if event.parent_id or not sub_events_on(event):
        return []
    subs = event.sub_events.filter(status__in=PUBLIC_EVENT_STATUSES).order_by('start_date', 'start_time', 'title')
    return [
        {
            'id': str(s.id), 'title': s.title, 'slug': s.slug, 'tagline': s.tagline,
            'start_date': s.start_date, 'start_time': s.start_time, 'end_date': s.end_date, 'end_time': s.end_time,
            'location': s.location, 'phase': s.phase(),
            'registration_open': s.registration_closed_reason() is None,
            'registration_closed_reason': s.registration_closed_reason(),
            'allow_registration': s.allow_registration,
        }
        for s in subs
    ]


def parent_card(event):
    if not event.parent_id or not sub_events_on(event):
        return None
    p = event.parent
    return {'id': str(p.id), 'title': p.title, 'slug': p.slug}
