from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from apps.events.models import Event, EventTicket
from .billing import add_months
from .models import Payment, Plan, PlanChangeRequest, Subscription
from .tests import make_user

B = '/api/platform/billing/'


class BillingBase(APITestCase):
    def setUp(self):
        self.admin = make_user('admin@x.com', 'superadmin')
        self.org = make_user('org@x.com', 'organizer', organization_name='Dharan Club')
        self.vendor = make_user('vendor@x.com', 'vendor', organization_name='Sound Co')
        self.staff = make_user('staff@x.com', 'staff')

    def as_(self, u):
        self.client.force_authenticate(user=u)


class BillingPermissionTests(BillingBase):
    ADMIN_GETS = ['summary/', 'subscriptions/', 'payments/', 'upgrade-requests/']

    def test_admin_endpoints_forbidden_for_others(self):
        for user in (self.org, self.vendor, self.staff):
            self.as_(user)
            for url in self.ADMIN_GETS:
                self.assertEqual(self.client.get(B + url).status_code, 403, (user.email, url))
            for action in ('record-payment', 'change-plan', 'cancel'):
                self.assertEqual(self.client.post(f'{B}subscriptions/{self.org.id}/{action}/', {}, format='json').status_code, 403)

    def test_mine_only_for_org_accounts(self):
        self.as_(self.staff)
        self.assertEqual(self.client.get(B + 'mine/').status_code, 403)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(B + 'mine/').status_code, 401)


class BillingFlowTests(BillingBase):
    def test_plans_seeded(self):
        self.as_(self.org)
        codes = [p['code'] for p in self.client.get(B + 'plans/').data]
        self.assertEqual(codes, ['free', 'event_pro', 'business', 'enterprise'])
        pro = Plan.objects.get(code='event_pro')
        self.assertEqual((pro.monthly_price, pro.yearly_price), (1499, 14390))

    def test_everyone_starts_on_free(self):
        self.as_(self.admin)
        rows = self.client.get(B + 'subscriptions/').data
        self.assertEqual({r['organization_email'] for r in rows}, {'org@x.com', 'vendor@x.com'})
        self.assertTrue(all(r['plan'] == 'free' for r in rows))
        self.as_(self.org)
        self.assertEqual(self.client.get(B + 'mine/').data['subscription']['plan'], 'free')

    def test_record_payment_extends_and_summary(self):
        self.as_(self.admin)
        url = f'{B}subscriptions/{self.org.id}/record-payment/'
        self.assertEqual(self.client.post(url, {'plan': 'free', 'amount': 10, 'method': 'esewa'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url, {'plan': 'event_pro', 'amount': 0, 'method': 'esewa'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url, {'plan': 'event_pro', 'amount': 1499, 'method': 'bitcoin'}, format='json').status_code, 400)
        res = self.client.post(url, {'plan': 'event_pro', 'billing_cycle': 'monthly', 'amount': 1499, 'method': 'esewa', 'months': 1, 'reference': 'ES-1'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        sub = Subscription.objects.get(organization=self.org)
        self.assertEqual((sub.plan.code, sub.status), ('event_pro', 'active'))
        first_end = sub.current_period_end
        self.assertAlmostEqual((first_end - timezone.now()).days, 30, delta=2)
        # A second payment extends from the current end, not from today
        self.client.post(url, {'plan': 'event_pro', 'amount': 2998, 'method': 'khalti', 'months': 2}, format='json')
        sub.refresh_from_db()
        self.assertEqual(sub.current_period_end, add_months(first_end, 2))

        s = self.client.get(B + 'summary/').data
        self.assertEqual(s['mrr'], 1499)
        self.assertEqual(s['arr'], 1499 * 12)
        self.assertEqual(s['active_paid'], 1)
        self.assertEqual(s['revenue_this_month'], 1499 + 2998)
        self.assertEqual(len(s['revenue_by_month']), 12)
        self.assertEqual(s['revenue_by_month'][-1]['amount'], 1499 + 2998)
        mix = {m['plan']: m['count'] for m in s['plan_mix']}
        self.assertEqual((mix['event_pro'], mix['free']), (1, 1))

    def test_past_due_and_expiring_filters(self):
        free = Plan.objects.get(code='business')
        Subscription.objects.create(organization=self.org, plan=free, status='active', current_period_end=timezone.now() - timedelta(days=1))
        Subscription.objects.create(organization=self.vendor, plan=free, status='active', current_period_end=timezone.now() + timedelta(days=5))
        self.as_(self.admin)
        s = self.client.get(B + 'summary/').data
        self.assertEqual((s['past_due'], s['expiring_7d'], s['expiring_30d']), (1, 1, 1))
        self.assertEqual([r['organization_email'] for r in self.client.get(B + 'subscriptions/?expiring=7').data], ['vendor@x.com'])
        self.assertEqual([r['organization_email'] for r in self.client.get(B + 'subscriptions/?status=past_due').data], ['org@x.com'])
        self.assertEqual(len(self.client.get(B + 'subscriptions/?plan=business&search=sound').data), 1)

    def test_change_plan_and_cancel(self):
        self.as_(self.admin)
        res = self.client.post(f'{B}subscriptions/{self.org.id}/change-plan/', {'plan': 'business', 'billing_cycle': 'yearly'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.data['plan'], res.data['status'], res.data['billing_cycle']), ('business', 'trial', 'yearly'))
        self.assertEqual(self.client.post(f'{B}subscriptions/{self.org.id}/change-plan/', {'plan': 'nope'}, format='json').status_code, 400)
        res = self.client.post(f'{B}subscriptions/{self.org.id}/cancel/')
        self.assertEqual((res.data['status'], res.data['auto_renew']), ('cancelled', False))
        self.assertEqual(self.client.post(f'{B}subscriptions/{self.vendor.id}/cancel/').status_code, 400)  # free
        self.assertEqual(self.client.post(f'{B}subscriptions/{self.staff.id}/cancel/').status_code, 404)

    def test_payments_filters_csv_refund(self):
        self.as_(self.admin)
        self.client.post(f'{B}subscriptions/{self.org.id}/record-payment/', {'plan': 'event_pro', 'amount': 1499, 'method': 'esewa'}, format='json')
        self.client.post(f'{B}subscriptions/{self.vendor.id}/record-payment/', {'plan': 'business', 'amount': 3999, 'method': 'bank'}, format='json')
        self.assertEqual(len(self.client.get(B + 'payments/').data), 2)
        self.assertEqual(len(self.client.get(B + 'payments/?method=bank').data), 1)
        today = timezone.localdate()
        self.assertEqual(len(self.client.get(f'{B}payments/?from={today}&to={today}').data), 2)
        self.assertEqual(len(self.client.get(f'{B}payments/?from={today + timedelta(days=1)}').data), 0)
        res = self.client.get(B + 'payments/?format=csv')
        self.assertEqual(res.status_code, 200)
        self.assertIn('text/csv', res['Content-Type'])
        body = res.content.decode()
        self.assertIn('Amount (NPR)', body)
        self.assertIn('Dharan Club', body)
        pay = Payment.objects.get(method='esewa')
        self.assertEqual(self.client.post(f'{B}payments/{pay.id}/refund/', {}, format='json').status_code, 400)
        res = self.client.post(f'{B}payments/{pay.id}/refund/', {'note': 'Double charge'}, format='json')
        self.assertEqual(res.data['status'], 'refunded')
        self.assertEqual(self.client.post(f'{B}payments/{pay.id}/refund/', {'note': 'x'}, format='json').status_code, 400)
        self.assertEqual(self.client.get(B + 'summary/').data['revenue_this_month'], 3999)

    def test_upgrade_requests(self):
        self.as_(self.staff)
        self.assertEqual(self.client.post(B + 'upgrade-requests/', {'plan': 'business'}, format='json').status_code, 403)
        self.as_(self.org)
        self.assertEqual(self.client.post(B + 'upgrade-requests/', {'plan': 'free'}, format='json').status_code, 400)  # already on it
        res = self.client.post(B + 'upgrade-requests/', {'plan': 'business', 'billing_cycle': 'yearly', 'note': 'Fest season'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(self.client.post(B + 'upgrade-requests/', {'plan': 'event_pro'}, format='json').status_code, 400)
        self.assertEqual(self.client.get(B + 'mine/').data['requests'][0]['status'], 'pending')
        req_id = res.data['id']
        self.as_(self.org)
        self.assertEqual(self.client.post(f'{B}upgrade-requests/{req_id}/approve/').status_code, 403)
        self.as_(self.admin)
        self.assertEqual(len(self.client.get(B + 'upgrade-requests/').data), 1)
        res = self.client.post(f'{B}upgrade-requests/{req_id}/approve/')
        self.assertEqual(res.data['status'], 'approved')
        self.assertEqual(Subscription.objects.get(organization=self.org).plan.code, 'business')
        self.assertEqual(self.client.post(f'{B}upgrade-requests/{req_id}/approve/').status_code, 400)
        r2 = PlanChangeRequest.objects.create(organization=self.vendor, requested_plan=Plan.objects.get(code='event_pro'))
        self.assertEqual(self.client.post(f'{B}upgrade-requests/{r2.id}/decline/', {}, format='json').status_code, 400)
        self.assertEqual(self.client.post(f'{B}upgrade-requests/{r2.id}/decline/', {'note': 'Call us'}, format='json').data['status'], 'declined')

    def test_mine_hides_internal_fields(self):
        self.as_(self.admin)
        self.client.post(f'{B}subscriptions/{self.org.id}/record-payment/', {'plan': 'event_pro', 'amount': 1499, 'method': 'esewa', 'note': 'internal'}, format='json')
        self.as_(self.org)
        data = self.client.get(B + 'mine/').data
        self.assertEqual(data['subscription']['plan'], 'event_pro')
        self.assertEqual(len(data['payments']), 1)
        self.assertNotIn('note', data['payments'][0])
        self.assertEqual(len(data['plans']), 4)


class SegmentsTests(BillingBase):
    def setUp(self):
        super().setUp()
        Event.objects.create(organizer=self.org, title='Fest', slug='fest', location='BP Hall, dharan', start_date=timezone.localdate())
        ev = Event.objects.get(slug='fest')
        EventTicket.generate_ticket(ev, 'A', 'a@x.com')

    def test_permissions(self):
        self.as_(self.org)
        self.assertEqual(self.client.get('/api/platform/segments/').status_code, 403)

    def test_segments(self):
        self.as_(self.admin)
        res = self.client.get('/api/platform/segments/?range=90')
        self.assertEqual(res.status_code, 200)
        d = res.data
        self.assertEqual(d['range'], 90)
        types = {r['key']: r for r in d['by_type']}
        self.assertEqual(types['events_only']['accounts'], 1)
        self.assertEqual(types['events_only']['registrations'], 1)
        self.assertEqual(types['vendor']['accounts'], 1)
        self.assertEqual(types['staff']['accounts'], 1)
        dharan = next(c for c in d['by_city'] if c['city'] == 'Dharan')
        self.assertEqual((dharan['orgs'], dharan['events'], dharan['registrations']), (1, 1, 1))
        plans = {p['plan']: p for p in d['by_plan']}
        self.assertEqual(plans['free']['orgs'], 2)
        self.assertEqual(len(d['growth']), 13)
        self.assertEqual(sum(w['organizer'] + w['vendor'] + w['both'] for w in d['growth']), 2)
        self.assertEqual(d['engagement']['active'], 1)
        self.assertIn('listings_by_category', d['marketplace'])
        self.assertEqual(self.client.get('/api/platform/segments/?range=abc').data['range'], 30)

    def test_org_filters_from_segments(self):
        self.as_(self.admin)
        url = '/api/platform/organizations/'
        self.assertEqual([r['email'] for r in self.client.get(url + '?city=Dharan').data], ['org@x.com'])
        self.assertEqual(len(self.client.get(url + '?plan=free').data), 2)
        self.assertEqual(len(self.client.get(url + '?plan=business').data), 0)
        self.assertEqual([r['email'] for r in self.client.get(url + '?type=events_only').data], ['org@x.com'])
        self.assertEqual(self.client.get(url + '?type=both').data, [])
        self.assertEqual(self.client.get(url).data[0]['plan'], 'Free')


class PlanSwitchTests(BillingBase):
    def test_switching_paid_plans_starts_trial_same_plan_keeps_period(self):
        self.as_(self.admin)
        self.client.post(f'{B}subscriptions/{self.org.id}/record-payment/', {'plan': 'event_pro', 'amount': 1499, 'method': 'esewa'}, format='json')
        paid_end = Subscription.objects.get(organization=self.org).current_period_end
        res = self.client.post(f'{B}subscriptions/{self.org.id}/change-plan/', {'plan': 'event_pro', 'billing_cycle': 'yearly'}, format='json')
        self.assertEqual((res.data['status'], res.data['billing_cycle']), ('active', 'yearly'))
        self.assertEqual(Subscription.objects.get(organization=self.org).current_period_end, paid_end)
        res = self.client.post(f'{B}subscriptions/{self.org.id}/change-plan/', {'plan': 'business', 'billing_cycle': 'monthly'}, format='json')
        self.assertEqual(res.data['status'], 'trial')
