"""Re-check white-label custom domains: DNS verification + certificate status.

    manage.py check_tenant_domains            # domains still waiting (DNS or certificate)
    manage.py check_tenant_domains --all      # also re-verify live domains (DNS only downgrades on a definite answer)
    manage.py check_tenant_domains --domain event.dharanfilmfestival.org

Run it every 10 minutes from cron / a systemd timer (docs/white-label.md).
"""
from django.core.management.base import BaseCommand
from django.db.models import Q

from apps.accounts.domains import check_domain
from apps.accounts.models import TenantBranding
from apps.platform.models import WhiteLabelRequest


class Command(BaseCommand):
    help = 'Verify white-label custom domains (DNS) and sync their HTTPS certificates.'

    def add_arguments(self, parser):
        parser.add_argument('--all', action='store_true', help='Also re-check domains that are already live.')
        parser.add_argument('--domain', help='Only this custom domain.')

    def handle(self, *args, **opts):
        approved = WhiteLabelRequest.objects.filter(status=WhiteLabelRequest.Status.APPROVED).values('organizer_id')
        qs = (TenantBranding.objects.select_related('organizer')
              .filter(organizer_id__in=approved).exclude(custom_domain__isnull=True).exclude(custom_domain=''))
        if opts.get('domain'):
            qs = qs.filter(custom_domain__iexact=opts['domain'].strip().lower())
        elif not opts.get('all'):
            qs = qs.filter(Q(is_domain_verified=False) | Q(ssl_active=False))
        n = 0
        for branding in qs:
            check_domain(branding, recheck_verified=bool(opts.get('all') or opts.get('domain') or not branding.is_domain_verified))
            n += 1
            state = 'live' if branding.is_domain_verified and branding.ssl_active else (
                'ssl pending' if branding.is_domain_verified else 'dns pending')
            message = branding.provider_message if branding.is_domain_verified else branding.dns_message
            self.stdout.write(f'{branding.custom_domain}: {state} — {message}')
        self.stdout.write(self.style.SUCCESS(f'Checked {n} domain{"" if n == 1 else "s"}.'))
