"""One-click contest presets. Each fills settings, rounds, criteria, categories and profile fields — all editable later."""
from django.db import transaction

from .models import ContestCategory, ContestRound, Criterion, Poll, ProfileField

PRESETS = {
    'pageant': {
        'name': 'Pageant: online public vote + judges finale',
        'description': 'Miss/Mr-style pageant. Daily free online votes through the top rounds, judges score the finale '
                       '(70% judges + 30% public).',
        'settings': {
            'vote_mode': Poll.VoteMode.SMS_OTP, 'votes_per_voter': None, 'votes_per_day': 5, 'votes_per_contestant': None,
            'allow_split': True, 'max_votes_per_submit': 5, 'results_visibility': Poll.ResultsVisibility.RANKS_ONLY,
            'results_top_n': 10, 'captcha_enabled': True, 'show_judge_breakdown': True, 'main_vote_enabled': True,
            'placement_titles': ['Winner', '1st runner-up', '2nd runner-up'],
        },
        'profile_fields': [
            ('age', 'Age', 'number', True), ('height', 'Height', 'text', True), ('district', 'District', 'text', True),
            ('hobbies', 'Hobbies', 'text', True), ('phone', 'Phone (private)', 'text', False),
        ],
        'rounds': [
            {'name': 'Audition', 'public_vote_enabled': True, 'judging_enabled': False, 'public_weight': 100, 'judge_weight': 0,
             'advance_count': 20},
            {'name': 'Top 20', 'public_vote_enabled': True, 'judging_enabled': True, 'public_weight': 50, 'judge_weight': 50,
             'advance_count': 10, 'criteria': [('Beauty', 30), ('Talent', 30), ('Q&A', 40)]},
            {'name': 'Top 10', 'public_vote_enabled': True, 'judging_enabled': True, 'public_weight': 40, 'judge_weight': 60,
             'advance_count': 5, 'criteria': [('Beauty', 30), ('Talent', 30), ('Q&A', 40)]},
            {'name': 'Finale', 'public_vote_enabled': True, 'judging_enabled': True, 'public_weight': 30, 'judge_weight': 70,
             'judge_aggregation': 'drop_high_low', 'criteria': [('Beauty', 30), ('Talent', 30), ('Q&A', 40)],
             'results_visibility': Poll.ResultsVisibility.HIDDEN},
        ],
        'categories': [
            {'name': 'People’s Choice', 'selection': 'public_vote', 'votes_per_day': 1},
            {'name': 'Miss Photogenic', 'selection': 'manual'},
            {'name': 'Best Talent', 'selection': 'judges', 'criterion': 'Talent'},
        ],
    },
    'talent': {
        'name': 'Talent show: live audience + judges',
        'description': 'Performers on stage; the audience votes from their seats (one vote per ticket) and judges score '
                       'each act. 60% judges + 40% audience.',
        'settings': {
            'vote_mode': Poll.VoteMode.TICKET, 'votes_per_voter': None, 'votes_per_round': 1, 'votes_per_day': None,
            'allow_split': False, 'max_votes_per_submit': 1, 'results_visibility': Poll.ResultsVisibility.AFTER_CLOSE,
            'captcha_enabled': False, 'show_judge_breakdown': True, 'main_vote_enabled': True,
        },
        'profile_fields': [('act', 'Act', 'select', True, ['Singing', 'Dance', 'Comedy', 'Instrument', 'Other']),
                           ('from', 'From', 'text', True)],
        'rounds': [
            {'name': 'Semi-final', 'public_vote_enabled': True, 'judging_enabled': True, 'public_weight': 40, 'judge_weight': 60,
             'advance_count': 5, 'criteria': [('Skill', 40), ('Stage presence', 30), ('Originality', 30)]},
            {'name': 'Final', 'public_vote_enabled': True, 'judging_enabled': True, 'public_weight': 40, 'judge_weight': 60,
             'criteria': [('Skill', 40), ('Stage presence', 30), ('Originality', 30)]},
        ],
        'categories': [],
    },
    'awards': {
        'name': 'Awards: categories, one vote each',
        'description': 'Several award categories, each with its own nominees. Every voter gets one vote per category.',
        'settings': {
            'vote_mode': Poll.VoteMode.EMAIL_OTP, 'votes_per_voter': 1, 'votes_per_day': None, 'votes_per_round': None,
            'allow_split': False, 'max_votes_per_submit': 1, 'results_visibility': Poll.ResultsVisibility.HIDDEN,
            'main_vote_enabled': False, 'captcha_enabled': True, 'show_judge_breakdown': False,
        },
        'profile_fields': [],
        'rounds': [],
        'categories': [
            {'name': 'Best Film', 'selection': 'public_vote'},
            {'name': 'Best Director', 'selection': 'public_vote'},
            {'name': 'Best Actor', 'selection': 'public_vote'},
        ],
    },
    'quick': {
        'name': 'Quick poll',
        'description': 'Today’s simple audience poll: one ballot per voter, live results.',
        'settings': {},
        'profile_fields': [], 'rounds': [], 'categories': [],
    },
}


def preset_list():
    return [{'key': k, 'name': v['name'], 'description': v['description'],
             'kind': 'poll' if k == 'quick' else 'contest',
             'rounds': [r['name'] for r in v['rounds']], 'categories': [c['name'] for c in v['categories']]}
            for k, v in PRESETS.items()]


@transaction.atomic
def apply_preset(poll, key, replace=True):
    """Fill a contest from a preset. With replace, existing rounds/categories/profile fields are replaced
    (only allowed before votes or scores exist — callers check)."""
    from django.utils.text import slugify
    p = PRESETS[key]
    for k, v in p['settings'].items():
        setattr(poll, k, v)
    poll.preset = key
    poll.save()
    if replace:
        poll.categories.all().delete()
        poll.rounds.all().delete()
        poll.profile_fields.all().delete()
    for i, f in enumerate(p['profile_fields']):
        ProfileField.objects.create(poll=poll, key=f[0], label=f[1], field_type=f[2], is_public=f[3],
                                    options=f[4] if len(f) > 4 else [], order=i)
    criteria_by_name = {}
    for i, r in enumerate(p['rounds']):
        data = {k: v for k, v in r.items() if k != 'criteria'}
        rnd = ContestRound.objects.create(poll=poll, order=i, **data)
        for j, (name, mx) in enumerate(r.get('criteria', [])):
            criteria_by_name[name] = Criterion.objects.create(round=rnd, name=name, max_points=mx, weight=1, order=j)
    for i, c in enumerate(p['categories']):
        crit = criteria_by_name.get(c.get('criterion')) if c.get('criterion') else None
        ContestCategory.objects.create(
            poll=poll, name=c['name'], slug=slugify(c['name'])[:80], selection=c['selection'], order=i,
            votes_per_day=c.get('votes_per_day'), criterion=crit, round=crit.round if crit else None,
        )
    return poll
