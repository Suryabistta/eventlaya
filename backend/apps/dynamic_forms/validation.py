"""Server-side checks for registration form answers (the website and app check the same rules first).

`FormField.validation_rules` keys: `min` / `max` (number), `max_length` (text, paragraph),
`min_age` / `max_age` (date of birth). Choice answers must be one of the field's options.
"""
import re
from datetime import date

from django.conf import settings

from .models import FormField

T = FormField.FieldType
EMAIL = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
URL = re.compile(r'^https?://[^\s]+\.[^\s]+$', re.I)
MAX_TEXT = 5000


def _age_on(birth, today):
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))


def answer_error(field, value, event_id=None):
    """Why `value` isn't a valid answer to `field`, or None. Empty answers are left to the required check."""
    if field.field_type == T.HEADING or value in (None, '', []):
        return None
    rules = field.validation_rules if isinstance(field.validation_rules, dict) else {}
    label = field.label
    options = [str(o) for o in (field.options or [])]

    if field.field_type in (T.SELECT, T.RADIO):
        return None if str(value) in options else f'Choose one of the options for “{label}”.'
    if field.field_type == T.CHECKBOX:
        if not options:  # a single tick box (consent)
            return None if value in (True, 'true', 'on', 1, '1') else f'“{label}” must be ticked.'
        values = value if isinstance(value, list) else [value]
        return None if all(str(v) in options for v in values) else f'Choose from the options for “{label}”.'

    if isinstance(value, (list, dict)):
        return f'“{label}” has an invalid answer.'
    text = str(value).strip()
    if field.field_type == T.NUMBER:
        try:
            n = float(text)
        except ValueError:
            return f'“{label}” must be a number.'
        if rules.get('min') is not None and n < float(rules['min']):
            return f'“{label}” must be at least {rules["min"]}.'
        if rules.get('max') is not None and n > float(rules['max']):
            return f'“{label}” must be at most {rules["max"]}.'
        return None
    if field.field_type == T.EMAIL:
        return None if EMAIL.match(text) else f'Enter a valid email for “{label}”.'
    if field.field_type == T.URL:
        return None if URL.match(text) and len(text) <= 1000 else f'Enter a full link starting with https:// for “{label}”.'
    if field.field_type in (T.FILE_UPLOAD, T.IMAGE):
        # Only files uploaded through this form's upload endpoint
        eid = event_id or field.form.event_id or 'none'
        ok = (text.startswith(f'{settings.MEDIA_URL}uploads/forms/{eid}/') or text.startswith(f'/api/forms/files/{eid}/')) and '..' not in text
        return None if ok else f'Upload the file for “{label}” again.'
    if field.field_type == T.DATE:
        try:
            d = date.fromisoformat(text)
        except ValueError:
            return f'Enter a valid date for “{label}”.'
        age = _age_on(d, date.today())
        if rules.get('min_age') is not None and age < int(rules['min_age']):
            return f'You must be at least {rules["min_age"]} for “{label}”.'
        if rules.get('max_age') is not None and age > int(rules['max_age']):
            return f'You must be {rules["max_age"]} or younger for “{label}”.'
        return None
    limit = int(rules.get('max_length') or MAX_TEXT)
    if len(text) > min(limit, MAX_TEXT):
        return f'“{label}” can be at most {min(limit, MAX_TEXT)} characters.'
    return None


def is_visible(field, answers, ticket_type_ids=None, _depth=0):
    """Whether the question is asked: its ticket types (if any) were chosen, and its condition (show_if) holds."""
    types = [str(t) for t in (field.ticket_types or [])]
    if types and ticket_type_ids is not None and not (set(types) & {str(t) for t in ticket_type_ids}):
        return False
    cond = field.show_if if isinstance(field.show_if, dict) else {}
    if not cond.get('field'):
        return True
    # A question under a hidden question is hidden too (chains of conditions)
    parent = field.form.fields.filter(pk=cond['field']).first() if field.form_id else None
    if parent is not None and parent.pk != field.pk and _depth < 10 and not is_visible(parent, answers, ticket_type_ids, _depth + 1):
        return False
    value = (answers or {}).get(str(cond['field']))
    wanted = [str(v) for v in (cond.get('values') or [])]
    if isinstance(value, list):
        return bool(value) and (not wanted or any(str(v) in wanted for v in value))
    if value in (None, '', False):
        return False
    return not wanted or str(value) in wanted
