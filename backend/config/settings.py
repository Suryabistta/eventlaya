import os
from pathlib import Path
from datetime import timedelta

BASE_DIR = Path(__file__).resolve().parent.parent

# Development defaults; production sets DEBUG=0, SECRET_KEY, ALLOWED_HOSTS and CORS_ALLOWED_ORIGINS
DEBUG = os.environ.get('DEBUG', '1') == '1'

SECRET_KEY = os.environ.get('SECRET_KEY', 'eventlaya-insecure-dev-secret-key-2026' if DEBUG else '')
if not SECRET_KEY:
    raise RuntimeError('Set the SECRET_KEY environment variable when DEBUG=0')

# Host checking is done by apps.accounts.tenancy.TenantMiddleware, not Django: white-label customers bring
# their own domains (event.dharanfilmfestival.org), which can't be listed in an env var. The middleware
# accepts PLATFORM_HOSTS (the ALLOWED_HOSTS env, e.g. "eventlaya.com,www.eventlaya.com,api.eventlaya.com"),
# any <name>.PLATFORM_DOMAIN and domains claimed by an organization; anything else gets 400.
PLATFORM_HOSTS = [h.strip() for h in os.environ.get('ALLOWED_HOSTS', '*').split(',') if h.strip()]
ALLOWED_HOSTS = ['*']

AUTH_USER_MODEL = 'accounts.User'

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third-party
    'rest_framework',
    'corsheaders',
    'drf_spectacular',

    # Local apps
    'apps.accounts',
    'apps.events',
    'apps.dynamic_forms',
    'apps.voting',
    'apps.marketplace',
    'apps.platform',
    'apps.chat',
    'apps.reviews',
    'apps.payments',
    'apps.blog',
    'apps.seo',
    'apps.site_analytics',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'apps.accounts.tenancy.TenantMiddleware',  # Host validation (see PLATFORM_HOSTS) for white-label domains
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'apps.accounts.modules.ModuleAccessMiddleware',  # superadmin on/off switches per feature
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# Team chat websockets (Django Channels). Redis in production; in-memory (single process) when
# REDIS_URL is unset, e.g. local dev and tests.
ASGI_APPLICATION = 'config.asgi.application'
if os.environ.get('REDIS_URL'):
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {'hosts': [os.environ['REDIS_URL']], 'capacity': 200, 'expiry': 30},
        },
    }
else:
    CHANNEL_LAYERS = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}

if os.environ.get('POSTGRES_DB'):
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.environ['POSTGRES_DB'],
            'USER': os.environ.get('POSTGRES_USER', ''),
            'PASSWORD': os.environ.get('POSTGRES_PASSWORD', ''),
            'HOST': os.environ.get('POSTGRES_HOST', '127.0.0.1'),
            'PORT': os.environ.get('POSTGRES_PORT', '5432'),
            'CONN_MAX_AGE': 60,
            'CONN_HEALTH_CHECKS': True,
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

if 'test' in __import__('sys').argv[1:2]:  # `manage.py test`: fast hashing so the suite isn't dominated by PBKDF2
    PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Kathmandu'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

MEDIA_URL = '/media/'
# Production keeps uploads on a mounted block-storage volume (see deploy/).
MEDIA_ROOT = os.environ.get('MEDIA_ROOT') or BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Django REST Framework
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
}

# Simple JWT
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=1),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=30),
    'ROTATE_REFRESH_TOKENS': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

# Spectacular Docs
SPECTACULAR_SETTINGS = {
    'TITLE': 'Eventlaya API',
    'DESCRIPTION': 'Event Management SaaS & Marketplace API',
    'VERSION': '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
}

# CORS
_cors_origins = [o.strip() for o in os.environ.get('CORS_ALLOWED_ORIGINS', '').split(',') if o.strip()]
CORS_ALLOW_ALL_ORIGINS = DEBUG and not _cors_origins
CORS_ALLOWED_ORIGINS = _cors_origins
CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = [o.strip() for o in os.environ.get('CSRF_TRUSTED_ORIGINS', '').split(',') if o.strip()]

# Behind Nginx terminating HTTPS
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

# Email Configuration
EMAIL_BACKEND = os.getenv('EMAIL_BACKEND', 'django.core.mail.backends.console.EmailBackend')
DEFAULT_FROM_EMAIL = 'Eventlaya Passes <passes@eventlaya.com>'
# Where links in emails (e.g. password reset) point to
FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost:5173')

# Version (date) of the Terms of Service + Privacy Policy users agree to at sign-up; stored on the user as
# terms_version. Bump it together with LAST_UPDATED in frontend/src/lib/legal.ts when the policies change.
TERMS_VERSION = os.getenv('TERMS_VERSION', '2026-10-28')

# Google Analytics 4 for eventlaya.com (apps.site_analytics, docs/analytics.md). Used while the superadmin hasn't
# saved an ID in Admin → Analytics; the console can override or switch it off. Never used on white-label sites.
GA_MEASUREMENT_ID = os.getenv('GA_MEASUREMENT_ID', '').strip()

# Social sign-in (apps.accounts.social). A provider is offered only when its settings are present.
GOOGLE_CLIENT_IDS = [c.strip() for c in os.getenv('GOOGLE_CLIENT_IDS', '').split(',') if c.strip()]  # web, android, ios
FACEBOOK_APP_ID = os.getenv('FACEBOOK_APP_ID', '')
FACEBOOK_APP_SECRET = os.getenv('FACEBOOK_APP_SECRET', '')

# White-label sites (docs/white-label.md)
PLATFORM_DOMAIN = os.getenv('PLATFORM_DOMAIN', 'eventlaya.com').lower()
# What customer domains CNAME to: the Cloudflare for SaaS fallback origin (proxied record → the droplet).
WHITELABEL_CNAME_TARGET = os.getenv('WHITELABEL_CNAME_TARGET', 'tenants.eventlaya.com').lower()
# Customer must also publish TXT _eventlaya.<domain> = eventlaya-verify=<token> (ownership proof).
WHITELABEL_REQUIRE_TXT = os.getenv('WHITELABEL_REQUIRE_TXT', '1') == '1'
# Free <name>.eventlaya.com addresses need the wildcard DNS record + wildcard origin certificate first.
WHITELABEL_SUBDOMAINS_ENABLED = os.getenv('WHITELABEL_SUBDOMAINS_ENABLED', '1' if DEBUG else '0') == '1'
# Optional resolvers for verification (comma separated); default: the server's resolver.
WHITELABEL_DNS_SERVERS = [s.strip() for s in os.getenv('WHITELABEL_DNS_SERVERS', '').split(',') if s.strip()]
# Cloudflare for SaaS custom hostnames. Both unset → "manual" mode (superadmin adds hostnames in the dashboard).
CLOUDFLARE_API_TOKEN = os.getenv('CLOUDFLARE_API_TOKEN', '')
CLOUDFLARE_ZONE_ID = os.getenv('CLOUDFLARE_ZONE_ID', '')
# Optional: send custom-hostname traffic to this origin (e.g. tenants.eventlaya.com) so the origin TLS SNI is ours.
CLOUDFLARE_CUSTOM_ORIGIN = os.getenv('CLOUDFLARE_CUSTOM_ORIGIN', '')

# Online payments: Khalti + eSewa (apps.payments, docs/payments.md). Keys come from the environment only.
# With DEBUG on, the public sandbox credentials from the providers' docs are used; with DEBUG off a provider
# without its keys is simply not offered.
PAYMENTS_ENABLED_PROVIDERS = [p.strip() for p in os.getenv('PAYMENTS_ENABLED_PROVIDERS', 'khalti,esewa').split(',') if p.strip()]
# Khalti ePayment v2. Sandbox: https://dev.khalti.com/api/v2/ (key from test-admin.khalti.com); live: https://khalti.com/api/v2/
KHALTI_SECRET_KEY = os.getenv('KHALTI_SECRET_KEY', 'live_secret_key_68791341fdd94846a146f0457ff7b455' if DEBUG else '')  # dev: Khalti docs' sandbox example key
KHALTI_BASE_URL = os.getenv('KHALTI_BASE_URL', 'https://dev.khalti.com/api/v2/' if DEBUG else 'https://khalti.com/api/v2/')
# eSewa ePay v2. Sandbox merchant EPAYTEST + its published secret; live values come from eSewa after onboarding.
ESEWA_PRODUCT_CODE = os.getenv('ESEWA_PRODUCT_CODE', 'EPAYTEST' if DEBUG else '')
ESEWA_SECRET_KEY = os.getenv('ESEWA_SECRET_KEY', '8gBm/:&EnhH.1/q' if DEBUG else '')
ESEWA_FORM_URL = os.getenv('ESEWA_FORM_URL', 'https://rc-epay.esewa.com.np/api/epay/main/v2/form' if DEBUG
                           else 'https://epay.esewa.com.np/api/epay/main/v2/form')
ESEWA_STATUS_URL = os.getenv('ESEWA_STATUS_URL', 'https://rc.esewa.com.np/api/epay/transaction/status/' if DEBUG
                             else 'https://esewa.com.np/api/epay/transaction/status/')
# A fake provider with Pay / Fail / Cancel buttons, for local development and tests. Never on in production.
PAYMENTS_TEST_PROVIDER = os.getenv('PAYMENTS_TEST_PROVIDER', '1' if DEBUG else '0') == '1'
# Where Khalti/eSewa send the browser back to (our API). Default: the host the request came in on.
PAYMENTS_CALLBACK_BASE_URL = os.getenv('PAYMENTS_CALLBACK_BASE_URL', '').rstrip('/')
