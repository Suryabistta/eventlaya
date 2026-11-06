// Contests, payments, deep links and module switches: parsing and rules, no widgets.
import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:eventlaya_scanner/attendee/data/contest_api.dart';
import 'package:eventlaya_scanner/attendee/models/contest.dart';
import 'package:eventlaya_scanner/core/deep_links.dart';
import 'package:eventlaya_scanner/models/scan_result_model.dart';
import 'package:eventlaya_scanner/models/ticket_type_model.dart';
import 'package:eventlaya_scanner/payments/checkout_screen.dart';
import 'package:eventlaya_scanner/payments/payment_api.dart';
import 'package:eventlaya_scanner/payments/payment_models.dart';
import 'package:eventlaya_scanner/payments/payment_widgets.dart';
import 'package:eventlaya_scanner/providers/modules_provider.dart';
import 'package:eventlaya_scanner/screens/common/passes.dart';
import 'package:flutter_test/flutter_test.dart';

/// Real responses from the contest API (photos blanked), captured from a local server.
final Map<String, dynamic> api = jsonDecode(File('test/fixtures/contest_api.json').readAsStringSync());

Map<String, dynamic> m(Object? v) => Map<String, dynamic>.from(v as Map);

DioException dioError(int status, Map<String, dynamic> body) {
  final o = RequestOptions(path: '/x');
  return DioException(requestOptions: o, response: Response(requestOptions: o, statusCode: status, data: body));
}

void main() {
  group('contest JSON', () {
    final c = Contest.fromJson(m(api['contest']));

    test('parses settings, rules, rounds, categories and paid packs', () {
      expect(c.title, 'Miss Biratnagar 2026');
      expect(c.voteMode, 'sms_otp');
      expect(c.usesOtp, isTrue);
      expect(c.rules.votesPerDay, 5);
      expect(c.rules.maxVotesPerSubmit, 5);
      expect(c.rules.votesPerContestant, 3);
      expect(c.rules.contestantCapText, 'At most 3 free votes per contestant per day.');
      expect(c.rounds.map((r) => r.name), ['Online audition', 'Top 10', 'Finale']);
      expect(c.currentRound?.name, 'Online audition');
      expect(c.categories.map((x) => x.name), containsAll(["People's Choice", 'Miss Photogenic']));
      expect(c.contestants, hasLength(8));
      expect(c.contestants.first.displayNumber, '#01');
      expect(c.contestants.first.profile.map((p) => p.label), containsAll(['Age', 'District']));
      expect(c.standings?.level, 'ranks');
      expect(c.standings?.rows.first.votes, isNull, reason: 'ranks only: no counts');
      expect(c.paid.canBuy, isTrue);
      expect(c.paid.showPacks, isTrue);
      expect(c.paid.packs.map((p) => p.totalVotes), [10, 60]);
      expect(c.paid.packs.last.priceLabel, 'Rs 200');
      expect(c.paid.providers.map((p) => p.id), contains('khalti'));
    });

    test('who can receive votes, and why not', () {
      final withdrawn = c.contestants.firstWhere((x) => x.status == 'withdrawn');
      final active = c.contestants.first;
      expect(c.canReceiveVotes(active), isTrue);
      expect(c.closedReason(active), isNull);
      expect(c.canReceiveVotes(withdrawn), isFalse);
      expect(c.closedReason(withdrawn), '${withdrawn.name} has withdrawn');
      expect(c.openCategoriesFor(active).map((x) => x.name), ["People's Choice"]);
    });

    test('status line and allowance wording mirror the web', () {
      expect(c.statusLine.title, 'Voting is open');
      expect(c.statusLine.body, contains('5 free votes a day'));
      expect(c.statusLine.body, contains('resets at midnight, Nepal time'));
      expect(const ContestRules(votesPerVoter: 1).allowanceText, '1 free vote');
      expect(const ContestRules(freeVotesEnabled: false).allowanceText, 'Votes come from vote packs');
      expect(const ContestRules(votesPerVoter: null).allowanceText, 'Unlimited free votes');
    });

    test('share links use the public web URL', () {
      expect(c.contestantUrl('7'), 'https://eventlaya.com/e/biratnagar-music-awards-2026/vote/miss-biratnagar-2026/c/7');
    });

    test('closed contest with a decided final round reveals the winner and placements', () {
      final closed = Contest.fromJson(m(api['closed']));
      expect(closed.isClosed, isTrue);
      expect(closed.resultsRevealed, isTrue);
      expect(closed.winner?.name, 'Vintage Nepal');
      expect(closed.placementTitle(1), 'Champion');
      expect(closed.placementTitle(2), 'Runner-up');
      expect(closed.standings?.full, isTrue);
      expect(closed.standings?.rows.first.votes, greaterThan(0));
    });

    test('event voting list splits quick polls from contests', () {
      final list = api['event_voting']['polls'] as List;
      expect(list.where((p) => p['kind'] == 'contest'), isNotEmpty);
      expect(list.where((p) => p['kind'] != 'contest'), isNotEmpty);
    });

    test('contestant detail has gallery-ready fields and neighbours', () {
      final d = m(api['contestant']);
      final x = Contestant.fromJson(m(d['contestant']));
      expect(x.number, 1);
      expect(x.next?.displayNumber, '#02');
      expect(x.socialLinks.keys, containsAll(['facebook', 'instagram']));
      expect(x.standingLevel, 'ranks');
    });
  });

  group('allowance', () {
    test('line: votes left today with reset time', () {
      expect(const Allowance(freeRemaining: 3, resetsDaily: true).line,
          'You have 3 free votes left today · resets at midnight Nepal time');
      expect(const Allowance(freeRemaining: 1).line, 'You have 1 free vote left');
      expect(const Allowance(freeRemaining: 0, resetsDaily: true).line,
          "You've used today's free votes. They reset at midnight, Nepal time.");
      expect(const Allowance(freeRemaining: 0).line, "You've used all your votes in this contest.");
      expect(const Allowance(freeRemaining: 2, credits: 10, resetsDaily: true).line,
          'You have 2 free votes left today, plus 10 from vote packs · resets at midnight Nepal time');
      expect(const Allowance(freeRemaining: 0, credits: 5).outOfVotes, isFalse);
    });

    test('most votes per submission: per-submit cap, what is left, per-contestant cap', () {
      const rules = ContestRules(maxVotesPerSubmit: 5);
      expect(maxVotesFor(rules, null), 5);
      expect(maxVotesFor(rules, const Allowance(freeRemaining: 2)), 2);
      expect(maxVotesFor(rules, const Allowance(freeRemaining: 2, credits: 10)), 5);
      expect(maxVotesFor(rules, const Allowance(freeRemaining: 5), contestantCap: 3), 3);
      expect(maxVotesFor(rules, const Allowance(freeRemaining: 5, credits: 1), contestantCap: 3), 4);
      expect(maxVotesFor(rules, const Allowance(freeRemaining: 0)), 1);
      expect(maxVotesFor(const ContestRules(maxVotesPerSubmit: 1), const Allowance()), 1);
    });
  });

  group('per-contestant votes left (server fields)', () {
    Allowance a(Map<String, dynamic> j) => Allowance.fromJson(j);
    const rules = ContestRules(maxVotesPerSubmit: 5, votesPerContestant: 3);

    test('stepper never exceeds what the server accepts: free for this contestant + credits', () {
      final one = a({'free_remaining': 5, 'credits': 0, 'contestant_id': 'c1', 'contestant_free_remaining': 1, 'contestant_used': 2});
      expect(maxVotesFor(rules, one, contestantCap: 3), 1, reason: 'server value wins over the rules-only guess');
      final withCredits = a({'free_remaining': 5, 'credits': 4, 'contestant_id': 'c1', 'contestant_free_remaining': 1});
      expect(maxVotesFor(rules, withCredits), 5, reason: 'credits are usable beyond the free cap (1 + 4)');
      final noCap = a({'free_remaining': 2, 'credits': 0, 'contestant_id': 'c1', 'contestant_free_remaining': null});
      expect(maxVotesFor(rules, noCap, contestantCap: 3), 2);
      // Older server without the contestant fields: fall back to the rules' cap
      expect(maxVotesFor(rules, a({'free_remaining': 5, 'credits': 0}), contestantCap: 3), 3);
    });

    test('cap reached for one contestant, others still open', () {
      final x = a({
        'free_remaining': 4,
        'resets_daily': true,
        'credits': 0,
        'contestant_id': 'c1',
        'contestant_free_remaining': 0,
        'contestant_used': 3,
        'contestant_cap_period': 'day',
      });
      expect(x.outHere, isTrue);
      expect(x.outOfVotes, isFalse);
      expect(x.lineFor('Asha'),
          "You've given Asha the most free votes allowed today (it resets at midnight, Nepal time). You can still vote for others.");
      final some = a({'free_remaining': 4, 'resets_daily': true, 'credits': 0, 'contestant_id': 'c1', 'contestant_free_remaining': 2});
      expect(some.lineFor('Asha'), 'You have 4 free votes left today · resets at midnight Nepal time · up to 2 free for Asha');
    });
  });

  group('custom vote amounts', () {
    test('parsed only with a per-vote price; price = votes × price', () {
      final p = ContestPaid.fromJson({
        'enabled': true,
        'payments_available': true,
        'price_per_vote': '4.00',
        'custom_votes': true,
        'max_custom_votes': 1000,
        'packs': [],
      });
      expect(p.customVotes, isTrue);
      expect(p.canBuy, isTrue, reason: 'custom votes alone are enough to buy');
      expect(p.priceFor(2), 8);
      expect(p.maxCustomVotes, 1000);
      expect(ContestPaid.fromJson({'enabled': true, 'custom_votes': true, 'price_per_vote': null}).customVotes, isFalse);
    });
  });

  group('account payment history', () {
    test('rows from /api/payments/mine/ merge with this phone\'s, newest first', () {
      final account = [
        PaymentRecord.fromAccount({
          'id': 'a',
          'purpose': 'vote_pack',
          'description': '60 votes · Miss Biratnagar 2026',
          'status': 'paid',
          'amount': '200.00',
          'provider': 'khalti',
          'created_at': '2026-10-28T08:00:00Z',
          'summary': {'type': 'vote_pack', 'votes': 60, 'contest': {'title': 'Miss Biratnagar 2026', 'slug': 'miss', 'event_slug': 'bma'}},
        }),
        PaymentRecord.fromAccount({
          'id': 'b',
          'purpose': 'ticket_order',
          'description': '2 tickets · Fest',
          'status': 'paid',
          'amount': '700.00',
          'created_at': '2026-10-27T08:00:00Z',
          'event': {'title': 'Fest', 'slug': 'fest'},
          'summary': {'type': 'ticket_order', 'ticket_count': 2, 'order_reference': 'ORD-1'},
        }),
      ];
      final phone = [
        PaymentRecord(id: 'b', purpose: 'ticket_order', description: '', amount: 700, createdAt: DateTime.utc(2026, 10, 27), status: 'pending'),
        PaymentRecord(id: 'c', purpose: 'ticket_order', description: 'Signed out', amount: 350, createdAt: DateTime.utc(2026, 10, 28, 9), status: 'paid'),
      ];
      final all = PaymentRecord.merge(account, phone);
      expect(all.map((r) => r.id), ['c', 'a', 'b']);
      expect(all[0].onAccount, isFalse, reason: 'device only');
      expect(all[1].summary, '60 votes · Miss Biratnagar 2026');
      expect(all[2].status, 'paid', reason: 'account data wins');
      expect((all[2].onAccount, all[2].onPhone), (true, true));
      expect(all[2].summary, '2 tickets · Order ORD-1');
    });
  });

  group('server errors', () {
    test('codes and extras are kept', () {
      final f = ContestFailure.from(dioError(409, {
        'error': "You've used today's free votes.",
        'code': 'allowance_used',
        'free_remaining': 0,
        'credits': 0,
      }));
      expect(f.code, 'allowance_used');
      expect(f.freeRemaining, 0);
      expect(f.message, "You've used today's free votes.");
      expect(f.staleContest, isTrue);

      final otp = ContestFailure.from(dioError(429, {'error': 'We just sent a code.', 'retry_after': 42}));
      expect(otp.code, 'rate_limited');
      expect(otp.retryAfter, 42);

      final token = ContestFailure.from(dioError(401, {'error': 'Verify first', 'code': 'verification_required'}));
      expect(token.needsVerification, isTrue);
    });

    test('a switched-off module reads as "not available", never a raw error', () {
      final f = ContestFailure.from(dioError(403, {'code': 'module_disabled', 'module': 'contests', 'error': 'x'}));
      expect(f.moduleDisabled, isTrue);
      expect(f.message, "Voting isn't available right now.");
      final p = ContestFailure.from(dioError(403, {'code': 'module_disabled', 'module': 'paid_votes'}));
      expect(p.message, "Buying votes isn't available right now.");
    });

    test('no connection', () {
      final f = ContestFailure.from(DioException(requestOptions: RequestOptions(), type: DioExceptionType.connectionError));
      expect(f.network, isTrue);
    });
  });

  group('time', () {
    test('Nepal time is UTC+5:45 whatever the phone zone', () {
      expect(nepalTime(DateTime.utc(2026, 10, 31, 7, 15)), 'Sat 31 Oct, 1:00 PM Nepal time');
    });
    test('countdown text', () {
      expect(countdownText(const Duration(days: 2, hours: 4, minutes: 3)), '2d 4h');
      expect(countdownText(const Duration(hours: 3, minutes: 12)), '3h 12m');
      expect(countdownText(const Duration(minutes: 4, seconds: 5)), '4m 05s');
    });
  });

  group('payments', () {
    test('payment options note and choices (online first, Khalti needs Rs 10)', () {
      final o = PaymentOptions.fromJson({
        'mode': 'both',
        'online': true,
        'venue': true,
        'providers': [
          {'id': 'khalti', 'name': 'Khalti', 'sandbox': true},
          {'id': 'esewa', 'name': 'eSewa', 'sandbox': true},
          {'id': 'test', 'name': 'Test payment', 'sandbox': true},
        ],
        'hold_minutes': 15,
      });
      expect(o.note, 'Pay online with Khalti or eSewa, or at the venue');
      expect(o.shortNote, 'Pay online or at the venue');
      expect(PaymentMethodPicker.choices(o.providers, true, 350), ['khalti', 'esewa', 'test', 'venue']);
      expect(PaymentMethodPicker.choices(o.providers, false, 5), ['esewa', 'test']);
      expect(PaymentOptions.venueOnly.note, 'Pay at the venue');
    });

    test('eSewa checkout is a signed form POST', () {
      final c = Checkout.fromJson({
        'form_action': 'https://rc-epay.esewa.com.np/api/epay/main/v2/form',
        'method': 'POST',
        'fields': {'amount': '350', 'signature': 'a+b/c=', 'transaction_uuid': 'x y'},
      });
      expect(c.isForm, isTrue);
      expect(c.formBody, 'amount=350&signature=a%2Bb%2Fc%3D&transaction_uuid=x+y');
      expect(Checkout.fromJson({'redirect_url': 'https://test-pay.khalti.com/?pidx=1'}).isForm, isFalse);
    });

    test('the provider return is recognised by the intent id', () {
      const id = 'b57469bc-41d4-4c73-bec8-d94de440b68f';
      expect(isPaymentReturn('https://eventlaya.com/e/x/register?payment=$id&status=paid', id), isTrue);
      expect(isPaymentReturn('http://localhost:5173/e/x/register?payment=$id&status=cancelled', id), isTrue);
      expect(isPaymentReturn('https://test-pay.khalti.com/?pidx=abc', id), isFalse);
      expect(isPaymentReturn('https://eventlaya.com/e/x/register?payment=other&status=paid', id), isFalse);
    });

    test('intent states', () {
      final i = PaymentIntent.fromJson({'id': '1', 'status': 'paid', 'fulfilled': true, 'amount': '50.00'});
      expect(i.isDone, isTrue);
      expect(i.amountLabel, 'Rs 50');
      expect(PaymentIntent.fromJson({'id': '1', 'status': 'expired'}).isFailed, isTrue);
      expect(PaymentIntent.fromJson({'id': '1', 'status': 'pending'}).isOpen, isTrue);
    });
  });

  group('passes and the gate', () {
    test('paid-online tickets have nothing to collect; pay-at-venue ones do', () {
      final venue = TicketTypeInfo.fromTicket({
        'price': '350.00',
        'payment': {'status': 'due', 'label': 'Pay Rs 350 at the venue'},
      });
      expect(venue.hasPriceDue, isTrue);
      expect(ticketTypeFields(venue).map((f) => f.label), contains('Pay at venue'));

      final online = TicketTypeInfo.fromTicket({
        'price': '350.00',
        'payment': {'status': 'paid', 'label': 'Paid online · Khalti · ref 4H7Ah'},
      });
      expect(online.hasPriceDue, isFalse);
      expect(online.paymentNote, 'Paid online · Khalti · ref 4H7Ah');
      expect(ticketTypeFields(online).map((f) => '${f.label}: ${f.value}'), contains('Payment: Paid online · Khalti · ref 4H7Ah'));

      // Older servers / tickets without an order: price means pay at the venue.
      expect(TicketTypeInfo.fromTicket({'price': '200'}).hasPriceDue, isTrue);
    });

    test('scan result "unpaid" is its own outcome, with a plain message', () {
      final r = ScanResultModel.fromJson({
        'status': 'cancelled',
        'result': 'unpaid',
        'message': '⛔ Entry Denied: Online payment not completed. This ticket is only held while the buyer pays.',
        'ticket': {'ticket_number': 'TKT-1', 'attendee_name': 'Asha'},
      }, 'tok');
      expect(r.outcome, ScanOutcome.unpaid);
      expect(ScanCopy.of(r).title, 'Not paid');
      expect(r.message, startsWith('Online payment not completed.'));
      expect(r.message, endsWith("Don't let them in on this pass."));
      // Older result values still map as before.
      expect(ScanResultModel.fromJson({'status': 'cancelled', 'result': 'cancelled'}, 't').outcome, ScanOutcome.cancelled);
    });
  });

  group('deep links', () {
    test('event, contest, contestant, ticket and payment returns', () {
      expect(parseDeepLink('https://eventlaya.com/e/dff-2026'), const EventLink('dff-2026'));
      expect(parseDeepLink('https://www.eventlaya.com/e/dff-2026/register'), const EventLink('dff-2026'));
      expect(parseDeepLink('https://eventlaya.com/e/dff-2026/vote/miss-dharan'), const VoteLink('dff-2026', 'miss-dharan'));
      expect(parseDeepLink('https://eventlaya.com/e/dff-2026/vote/miss-dharan/c/07'),
          const ContestantLinkTarget('dff-2026', 'miss-dharan', '07'));
      expect(parseDeepLink('https://eventlaya.com/ticket/abc123'), const TicketLink('abc123'));
      expect(
        parseDeepLink('https://eventlaya.com/e/dff-2026/register?payment=b57469bc-41d4-4c73-bec8-d94de440b68f&status=paid'),
        const PaymentReturnLink('b57469bc-41d4-4c73-bec8-d94de440b68f', status: 'paid', page: EventLink('dff-2026')),
      );
    });

    test('other hosts and paths are ignored', () {
      expect(parseDeepLink('https://example.com/e/dff-2026'), isNull);
      expect(parseDeepLink('https://eventlaya.com/blog/hello'), isNull);
      expect(parseDeepLink('not a link'), isNull);
      expect(parseDeepLink('https://eventlaya.com/e/x/register?payment=not-a-uuid'), const EventLink('x'));
    });
  });

  group('module switches (hide logic)', () {
    final strictAll = ModuleAccess.fromJson({
      'modules': [
        for (final s in ['voting', 'contests', 'paid_votes', 'payments']) {'slug': s, 'requires': []},
      ],
    });

    test('everything on', () {
      for (final s in [AppModule.voting, AppModule.contests, AppModule.paidVotes, AppModule.payments]) {
        expect(moduleOn(s, strictAll, const {}), isTrue, reason: s);
      }
    });

    test('a module needs the ones it depends on', () {
      final noPayments = ModuleAccess.fromJson({
        'modules': [
          for (final s in ['voting', 'contests', 'paid_votes']) {'slug': s, 'requires': []},
        ],
      });
      expect(moduleOn(AppModule.paidVotes, noPayments, const {}), isFalse);
      expect(moduleOn(AppModule.contests, noPayments, const {}), isTrue);

      final noVoting = ModuleAccess.fromJson({
        'modules': [
          for (final s in ['contests', 'paid_votes', 'payments']) {'slug': s, 'requires': []},
        ],
      });
      expect(moduleOn(AppModule.contests, noVoting, const {}), isFalse);
      expect(moduleOn(AppModule.paidVotes, noVoting, const {}), isFalse);
      expect(moduleOn(AppModule.payments, noVoting, const {}), isTrue);
    });

    test('a 403 module_disabled seen this session hides the feature', () {
      expect(moduleOn(AppModule.contests, strictAll, const {'contests'}), isFalse);
      expect(moduleOn(AppModule.paidVotes, strictAll, const {'contests'}), isFalse);
      expect(moduleOn(AppModule.voting, strictAll, const {'contests'}), isTrue);
    });

    test('signed out: unknown, so shown until the API says otherwise', () {
      expect(moduleOn(AppModule.contests, ModuleAccess.unknown, const {}), isTrue);
    });

    test('older servers without the voting sub-modules keep contests on', () {
      final old = ModuleAccess.fromJson({
        'modules': [
          {'slug': 'voting', 'is_globally_enabled': true},
          {'slug': 'payments', 'is_globally_enabled': true},
        ],
      });
      expect(old.strict, isFalse);
      expect(moduleOn(AppModule.contests, old, const {}), isTrue);
      expect(moduleOn(AppModule.paidVotes, old, const {}), isTrue);
    });
  });
}
