from django.apps import AppConfig

class AccountsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.accounts'

    def ready(self):
        from django.db.models.signals import post_delete, post_save
        from .models import PlatformModule, RoleModulePermission
        from .modules import clear_cache

        # Superadmin module switches take effect immediately in this process (others within 15 s).
        for model in (PlatformModule, RoleModulePermission):
            post_save.connect(lambda **kw: clear_cache(), sender=model, weak=False)
            post_delete.connect(lambda **kw: clear_cache(), sender=model, weak=False)

        # White-label sites: branding, approvals and module switches change which hosts are live.
        from django.apps import apps as django_apps
        from . import tenancy
        tenant_models = [PlatformModule, RoleModulePermission, django_apps.get_model('accounts', 'TenantBranding')]
        if django_apps.is_installed('apps.platform'):
            tenant_models.append(django_apps.get_model('platform', 'WhiteLabelRequest'))
        for model in tenant_models:
            post_save.connect(lambda **kw: tenancy.clear_cache(), sender=model, weak=False)
            post_delete.connect(lambda **kw: tenancy.clear_cache(), sender=model, weak=False)
