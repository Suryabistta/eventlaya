"""What a payment is for. Apps register a purpose once (in AppConfig.ready) with handlers:

    from apps.payments.registry import register_purpose
    register_purpose('vote_pack', on_paid=grant_votes, on_failed=release_votes, describe=describe_pack)

- on_paid(intent): deliver what was bought. Runs exactly once per intent, inside the transaction that
  holds the intent's row lock (so its DB writes commit together with `fulfilled_at`). Send emails with
  transaction.on_commit. It may run after the intent expired (a late payment): handle that case.
- on_failed(intent): optional; the payment is cancelled / failed / expired. Release holds. Runs once,
  on the first transition from created/pending to a closed state.
- on_refunded(intent): optional; someone recorded a refund.
- describe(intent) -> dict: optional; extra data for GET /api/payments/intents/<id>/ (e.g. the passes
  once paid). Whoever holds the intent id sees it, so keep it to what the payer may see.
"""
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass(frozen=True)
class Purpose:
    name: str
    on_paid: Callable
    on_failed: Optional[Callable] = None
    on_refunded: Optional[Callable] = None
    describe: Optional[Callable] = None
    label: str = ''


_PURPOSES: dict[str, Purpose] = {}


def register_purpose(purpose, on_paid, on_failed=None, describe=None, on_refunded=None, label=''):
    if not purpose or len(purpose) > 40:
        raise ValueError('purpose must be 1-40 characters')
    if not callable(on_paid):
        raise ValueError('on_paid must be callable')
    _PURPOSES[purpose] = Purpose(purpose, on_paid, on_failed, on_refunded, describe, label or purpose.replace('_', ' ').capitalize())
    return _PURPOSES[purpose]


def get_purpose(purpose):
    return _PURPOSES.get(purpose)


def purposes():
    return dict(_PURPOSES)
