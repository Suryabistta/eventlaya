#!/usr/bin/env node
/**
 * Unit tests for the analytics URL / parameter sanitizer (src/lib/analytics-url.ts). No test framework needed:
 * Node ≥ 22.18 runs the TypeScript file directly (type stripping).
 *
 *   node --test scripts/test-analytics-url.mjs      (or: npm run test:analytics)
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isAppPath,
  looksLikeToken,
  pageTitleFor,
  sanitizeParams,
  sanitizePath,
  sanitizeSearch,
  sanitizeUrl,
  scrubText,
} from '../src/lib/analytics-url.ts'

const loc = (href) => sanitizeUrl(href, 'https://eventlaya.com').location

test('pass links: the token never leaves', () => {
  assert.equal(loc('/ticket/8f3kZ2xQ9vLw7RtY1pBn'), 'https://eventlaya.com/ticket/:token')
  assert.equal(loc('/ticket/abc?print=1'), 'https://eventlaya.com/ticket/:token?print=redacted')
  assert.equal(sanitizePath('/ticket/'), '/ticket')
  assert.equal(sanitizePath('/reset-password/MjQ/c3x-4f9a8b7c6d5e'), '/reset-password/:token')
  assert.equal(sanitizePath('/verify-email/123456'), '/verify-email/:token')
})

test('reset-password, verification and login links: secrets and emails in the query are redacted', () => {
  assert.equal(loc('/reset-password?uid=MjQ&token=c3x-4f9a8b7c6d5e0a1b2c3d'), 'https://eventlaya.com/reset-password?uid=redacted&token=redacted')
  assert.equal(loc('/login?email=sita%40example.com'), 'https://eventlaya.com/login?email=redacted')
  assert.equal(loc('/verify-email?sent=1&next=%2Fapp%2Fevents%2Fnew'), 'https://eventlaya.com/verify-email?sent=1&next=redacted')
  assert.equal(loc('/verify-email?code=482913'), 'https://eventlaya.com/verify-email?code=redacted')
  assert.equal(loc('/e/x/vote?otp=123456'), 'https://eventlaya.com/e/x/vote?otp=redacted')
})

test('payment returns: provider data is redacted, harmless flags kept', () => {
  assert.equal(
    loc('/e/fest-2083/register?step=4&payment=6c1d2a3b-0000-4000-8000-000000000001&status=Completed'),
    'https://eventlaya.com/e/fest-2083/register?step=4&payment=redacted&status=Completed',
  )
  // Khalti sends the buyer's mobile number and IDs back in the URL
  assert.equal(
    loc('/e/fest/register?pidx=bZQLD9wRVWo4CdESSfuSsB&transaction_id=GFq9PFS7b2iYvL8Lir9oXe&mobile=98XXXXX904&amount=1300&purchase_order_name=Sita'),
    'https://eventlaya.com/e/fest/register?pidx=redacted&transaction_id=redacted&mobile=redacted&amount=redacted&purchase_order_name=redacted',
  )
  // eSewa: base64 data blob
  assert.equal(loc('/e/fest/register?data=eyJ0cmFuc2FjdGlvbl9jb2RlIjoiMDAwQVdFTyJ9'), 'https://eventlaya.com/e/fest/register?data=redacted')
})

test('emails, phone numbers, UUIDs and tokens in paths', () => {
  assert.equal(sanitizePath('/u/sita@example.com/profile'), '/u/:email/profile')
  assert.equal(sanitizePath('/u/sita%40example.com'), '/u/:email')
  assert.equal(sanitizePath('/app/events/6c1d2a3b-0000-4000-8000-000000000001/edit'), '/app/events/:id/edit')
  assert.equal(sanitizePath('/call/9812345678'), '/call/:number')
  assert.equal(sanitizePath('/x/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123ghiJKL456'), '/x/:token')
  // ordinary public pages are untouched
  assert.equal(sanitizePath('/e/pathibhara-film-festival-2083'), '/e/pathibhara-film-festival-2083')
  assert.equal(sanitizePath('/e/miss-dharan-2026/vote/contest/c/7-sita-rai'), '/e/miss-dharan-2026/vote/contest/c/7-sita-rai')
  assert.equal(sanitizePath('/blog/how-to-organize-an-event-in-itahari'), '/blog/how-to-organize-an-event-in-itahari')
  assert.equal(sanitizePath('/marketplace/venues/koshi-banquet/'), '/marketplace/venues/koshi-banquet')
  assert.equal(sanitizePath('/'), '/')
})

test('query: utm and filters kept (masked), click IDs dropped, fragment dropped', () => {
  assert.equal(
    loc('/events?utm_source=facebook&utm_campaign=dashain&fbclid=IwAR123abc&city=Dharan#top'),
    'https://eventlaya.com/events?utm_source=facebook&utm_campaign=dashain&city=Dharan',
  )
  assert.equal(loc('/blog?search=sita%40example.com+tips'), 'https://eventlaya.com/blog?search=(email)+tips')
  assert.equal(loc('/events?q=call+9812345678'), 'https://eventlaya.com/events?q=call+(number)')
  assert.equal(loc('/?debug_mode=1&_gl=1*abc&tenant=x.org'), 'https://eventlaya.com/')
  assert.equal(sanitizeSearch('?sita%40example.com'), '?redacted_param')
  assert.equal(loc('/signup?type=vendor'), 'https://eventlaya.com/signup?type=vendor')
  assert.equal(loc('/#features'), 'https://eventlaya.com/')
  assert.equal(loc('/login#access_token=EAAB123xyz'), 'https://eventlaya.com/login')
})

test('external referrers get the same treatment; non-web URLs are dropped', () => {
  assert.equal(loc('https://l.facebook.com/l.php?u=https%3A%2F%2Feventlaya.com&h=AT0abc'), 'https://l.facebook.com/l.php?u=redacted&h=redacted')
  assert.equal(loc('javascript:alert(1)'), '')
  assert.equal(loc(''), '')
  assert.deepEqual(sanitizeParams({ page_referrer: '' }), { page_referrer: '' })
})

test('scrubText masks personal data in free text', () => {
  assert.equal(scrubText('ram@example.com'), '(email)')
  assert.equal(scrubText('+977 981-234-5678 concert'), '(number) concert')
  assert.equal(scrubText('code 482913'), 'code (number)')
  assert.equal(scrubText('Dashain concert 2083'), 'Dashain concert 2083')
  assert.equal(scrubText('Concert on 2026-11-05'), 'Concert on 2026-11-05')
  assert.equal(scrubText('x'.repeat(300)).length, 100)
  assert.ok(looksLikeToken('8f3kZ2xQ9vLw7RtY1pBn'))
  assert.ok(!looksLikeToken('pathibhara-film-festival-2083'))
  assert.ok(!looksLikeToken('itahari'))
})

test('event parameters: personal-data names removed, values masked, items cleaned', () => {
  assert.deepEqual(
    sanitizeParams({
      method: 'email', email: 'a@b.com', name: 'Sita Rai', phone: '9812345678', value: 1300, currency: 'NPR',
      note: 'reach me at a@b.com', skip: undefined, ok: true, nested: { a: 1 },
      items: [{ item_id: 'general', item_name: 'General', price: 300, quantity: 2, attendee_name: 'Sita' }],
    }),
    {
      method: 'email', value: 1300, currency: 'NPR', note: 'reach me at (email)', ok: true,
      items: [{ item_id: 'general', item_name: 'General', price: 300, quantity: 2 }],
    },
  )
  assert.deepEqual(sanitizeParams({ item_id: '6c1d2a3b-0000-4000-8000-000000000001', transaction_id: 'ORD-7K2M9Q', poll_id: 'a@b.com' }), {
    item_id: '6c1d2a3b-0000-4000-8000-000000000001', transaction_id: 'ORD-7K2M9Q', poll_id: '(email)',
  })
  assert.deepEqual(sanitizeParams({ page_location: 'https://eventlaya.com/ticket/abcDEF1234567890xyz' }), {
    page_location: 'https://eventlaya.com/ticket/:token',
  })
})

test('page titles: public pages keep theirs, private ones use the clean path', () => {
  assert.equal(pageTitleFor('/e/fest', 'Fest 2083 | Eventlaya'), 'Fest 2083 | Eventlaya')
  assert.equal(pageTitleFor('/ticket/abcDEF1234567890xyz', 'Sita Rai’s pass'), 'Eventlaya: /ticket/:token')
  assert.equal(pageTitleFor('/app/events/6c1d2a3b-0000-4000-8000-000000000001', 'Edit'), 'Eventlaya: /app/events/:id')
  assert.ok(isAppPath('/app') && isAppPath('/admin/analytics') && isAppPath('/judge/1') && !isAppPath('/apply'))
})
