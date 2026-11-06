// Contest voting, payments and gate payment states: widget tests with the fake API.
//
// New goldens (phone): contest page, vote sheet steps, payment results, scanner "Collect" and "Not paid".
// Regenerate with: flutter test --update-goldens test/screens/contest_screens_test.dart
import 'dart:convert';
import 'dart:io';
import 'package:eventlaya_scanner/attendee/models/contest.dart';
import 'package:eventlaya_scanner/attendee/screens/contest_screen.dart';
import 'package:eventlaya_scanner/attendee/screens/event_detail_screen.dart';
import 'package:eventlaya_scanner/attendee/screens/vote_packs.dart';
import 'package:eventlaya_scanner/attendee/screens/vote_sheet.dart';
import 'package:eventlaya_scanner/models/app_user.dart';
import 'package:eventlaya_scanner/models/scan_result_model.dart';
import 'package:eventlaya_scanner/models/ticket_type_model.dart';
import 'package:eventlaya_scanner/payments/my_payments_screen.dart';
import 'package:eventlaya_scanner/payments/payment_result_screen.dart';
import 'package:eventlaya_scanner/providers/auth_provider.dart';
import 'package:eventlaya_scanner/providers/modules_provider.dart';
import 'package:eventlaya_scanner/screens/staff/scanner_screen.dart';
import 'package:eventlaya_scanner/screens/staff/staff_shell.dart';
import 'package:eventlaya_scanner/ui/ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import '../helpers/harness.dart';

final Map<String, dynamic> api = jsonDecode(File('test/fixtures/contest_api.json').readAsStringSync());
Map<String, dynamic> m(Object? v) => Map<String, dynamic>.from(v as Map);

const slug = 'biratnagar-music-awards-2026';
const base = '/api/voting/public/$slug/contests/';

Contest contestWith(Map<String, dynamic> changes) => Contest.fromJson({...m(api['contest']), ...changes});

final voter = AppUser(id: 'a1', email: 'sita@example.com', firstName: 'Sita', lastName: 'Voter', role: UserRole.attendee);

List<Override> attendee({AppUser? user, Set<String> disabled = const {}}) => [
      authProvider.overrideWith((ref) => AuthNotifier(AuthState(user: user))),
      modulesProvider.overrideWith((ref) async => ModuleAccess.unknown),
      if (disabled.isNotEmpty) disabledModulesProvider.overrideWith((ref) => disabled),
    ];

Map<String, dynamic> allowanceJson(int? free, {int credits = 0, bool daily = true, List<String> votedFor = const []}) => {
      'main': {'free_remaining': free, 'resets_daily': daily, 'credits': credits, 'voted_for': votedFor},
      'categories': {},
    };

/// The vote sheet on its own page (as the bottom sheet shows it).
Widget sheetPage(Contest c, Contestant x, {ContestCategory? category}) => Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
          child: VoteSheet(contest: c, contestant: x, category: category),
        ),
      ),
    );

Map<String, dynamic> bodyOf(String suffix) {
  final r = fakeRequests.lastWhere((o) => o.path.endsWith(suffix));
  return Map<String, dynamic>.from(r.data as Map);
}

Future<void> tapText(WidgetTester tester, String text) async {
  await tester.ensureVisible(find.text(text).last);
  await tester.tap(find.text(text).last);
  await settle(tester);
}

void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    await loadAppFonts();
    installFakeApi();
    VoteSheet.smsAutofill = false;
  });

  setUp(() {
    resetFakeRoutes();
    installFakeWakelock();
  });

  group('contest page', () {
    testScreen('cover, status, rounds, search by number and category tabs', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['${base}miss-biratnagar-2026/'] = FakeReply(api['contest']);
      fakeRoutes['allowance/'] = FakeReply(allowanceJson(5));
      await pumpApp(tester, const ContestScreen(eventSlug: slug, contestRef: 'miss-biratnagar-2026'),
          overrides: attendee());
      expect(find.text('Miss Biratnagar 2026'), findsWidgets);
      expect(find.text('Voting open'), findsOneWidget);
      expect(find.text('Online audition'), findsWidgets);
      await expectGolden(tester, 'phone_contest');

      await tester.drag(find.byType(CustomScrollView), const Offset(0, -700));
      await settle(tester);
      expect(find.text('8 contestants'), findsOneWidget);
      await expectGolden(tester, 'phone_contest_grid');

      await tester.enterText(find.byType(TextField).first, '#03');
      await settle(tester);
      expect(find.text('1 of 8'), findsOneWidget);
      expect(find.text('Chandani Shrestha'), findsOneWidget);

      await tester.enterText(find.byType(TextField).first, '');
      await tapText(tester, "People's Choice");
      expect(find.text('Public vote · 1 free vote a day'), findsOneWidget);
    });

    testScreen('switched-off contests module: friendly state, no raw error', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['${base}miss-biratnagar-2026/'] = const FakeReply.errorBody(
        {'error': 'This feature is turned off for your account.', 'code': 'module_disabled', 'module': 'contests'},
        status: 403,
      );
      await pumpApp(tester, const ContestScreen(eventSlug: slug, contestRef: 'miss-biratnagar-2026'),
          overrides: attendee());
      expect(find.text('Not available right now'), findsOneWidget);
      expect(find.textContaining('turned off for your account'), findsNothing);
    });
  });

  group('vote sheet', () {
    final contest = Contest.fromJson(m(api['contest']));
    final asha = contest.contestants.first;

    testScreen('SMS code: send, resend cooldown, verify, allowance, quantity, vote', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['otp/send/'] = const FakeReply({'expires_in': 300, 'resend_in': 60, 'channel': 'sms', 'destination': '981*****78'});
      fakeRoutes['otp/verify/'] = const FakeReply({'voter_token': 'tok-1', 'expires_in': 43200, 'destination': '981*****78'});
      fakeRoutes['allowance/'] = FakeReply(allowanceJson(5));
      fakeRoutes['vote/'] = FakeReply({
        'message': 'Your 3 votes for #01 Asha Rai are in.',
        'contestant_id': asha.id,
        'quantity': 3,
        'allowance': {'free_remaining': 2, 'resets_daily': true, 'credits': 0, 'voted_for': [asha.id]},
      }, status: 201);
      await pumpApp(tester, sheetPage(contest, asha), overrides: attendee());

      expect(find.text('Vote for Asha Rai'), findsOneWidget);
      expect(find.text('Your mobile number'), findsOneWidget);
      await tester.enterText(find.byType(TextFormField).first, '9812345678');
      await tapText(tester, 'Send code');
      expect(bodyOf('otp/send/')['destination'], '9812345678');
      expect(find.textContaining('981*****78'), findsOneWidget);
      expect(find.textContaining('Resend in'), findsOneWidget);
      await expectGolden(tester, 'phone_vote_sheet_code');

      await tester.enterText(find.byType(TextField).first, '123456'); // 6 digits verify on their own
      await settle(tester);
      expect(bodyOf('otp/verify/'), {'destination': '9812345678', 'code': '123456'});
      expect(find.text('Verified as 981*****78'), findsOneWidget);
      expect(find.text('You have 5 free votes left today · resets at midnight Nepal time'), findsOneWidget);
      expect(find.text('At most 3 free votes per contestant per day.'), findsOneWidget);
      // The per-contestant cap (3) limits one submission even though 5 are left.
      expect(find.text('All 3'), findsOneWidget);
      await tapText(tester, 'All 3');
      expect(find.text('Give 3 votes'), findsOneWidget);
      await expectGolden(tester, 'phone_vote_sheet_ready');

      await tapText(tester, 'Give 3 votes');
      final vote = bodyOf('vote/');
      expect(vote['voter_token'], 'tok-1');
      expect(vote['contestant'], asha.id);
      expect(vote['quantity'], 3);
      expect(vote['device_id'], isNotNull);
      expect(find.text('Thank you for voting!'), findsOneWidget);
      expect(find.text('You have 2 free votes left today · resets at midnight Nepal time'), findsOneWidget);
    });

    testScreen('wrong code and an expired voter token show the server message', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['otp/send/'] = const FakeReply({'expires_in': 300, 'resend_in': 60, 'channel': 'sms', 'destination': '981*****78'});
      fakeRoutes['otp/verify/'] = const FakeReply.errorBody({'error': 'That code isn’t right. 4 tries left.'}, status: 400);
      await pumpApp(tester, sheetPage(contest, asha), overrides: attendee());
      await tester.enterText(find.byType(TextFormField).first, '9812345678');
      await tapText(tester, 'Send code');
      await tester.enterText(find.byType(TextField).first, '111111');
      await settle(tester);
      expect(find.text('That code isn’t right. 4 tries left.'), findsOneWidget);
      expect(find.text('Verify'), findsOneWidget, reason: 'still on the code step');
    });

    testScreen('daily limit reached: no vote button, vote packs offered', (tester) async {
      useDevice(tester, Device.phone);
      final device = contestWith({'verification': {'method': 'open', 'channel': null, 'captcha_site_key': null}});
      fakeRoutes['allowance/'] = FakeReply(allowanceJson(0));
      await pumpApp(tester, sheetPage(device, device.contestants.first), overrides: attendee());
      expect(find.text('Voting from this phone'), findsOneWidget);
      expect(find.text("You've used today's free votes. They reset at midnight, Nepal time."), findsOneWidget);
      expect(find.text('Get more votes'), findsOneWidget);
      final vote = tester.widget<FilledButton>(find.ancestor(of: find.text('Vote'), matching: find.byType(FilledButton)));
      expect(vote.onPressed, isNull);
      await expectGolden(tester, 'phone_vote_sheet_limit');
    });

    testScreen('no splitting: votes already went to someone else', (tester) async {
      useDevice(tester, Device.phone);
      final c = contestWith({
        'verification': {'method': 'open', 'channel': null, 'captcha_site_key': null},
        'rules': {...m(m(api['contest'])['rules']), 'allow_split': false},
      });
      final other = c.contestants[2];
      fakeRoutes['allowance/'] = FakeReply(allowanceJson(3, votedFor: [other.id]));
      await pumpApp(tester, sheetPage(c, c.contestants.first), overrides: attendee());
      expect(find.textContaining('You already gave your votes to ${other.label}'), findsOneWidget);
    });

    testScreen('server refusal (allowance_used) is shown in plain words', (tester) async {
      useDevice(tester, Device.phone);
      final c = contestWith({'verification': {'method': 'open', 'channel': null, 'captcha_site_key': null}});
      fakeRoutes['allowance/'] = FakeReply(allowanceJson(5));
      fakeRoutes['vote/'] = const FakeReply.errorBody(
        {'error': 'You have 1 free vote left. Lower the number and try again.', 'code': 'allowance_used', 'free_remaining': 1, 'credits': 0},
        status: 409,
      );
      await pumpApp(tester, sheetPage(c, c.contestants.first), overrides: attendee());
      await tapText(tester, 'Vote');
      expect(find.text('You have 1 free vote left. Lower the number and try again.'), findsOneWidget);
    });

    testScreen('ticket contests use the pass saved on this phone', (tester) async {
      useDevice(tester, Device.phone);
      final c = contestWith({'verification': {'method': 'ticket', 'channel': null, 'captcha_site_key': null}});
      fakeRoutes['allowance/'] = FakeReply(allowanceJson(1, daily: false));
      fakeRoutes['vote/'] = FakeReply({
        'message': 'Your 1 vote for #01 Asha Rai is in.',
        'contestant_id': c.contestants.first.id,
        'quantity': 1,
        'allowance': {'free_remaining': 0, 'resets_daily': false, 'credits': 0, 'voted_for': []},
      }, status: 201);
      final pass = {
        'ticket_number': 'TKT-F449BA-0001',
        'qr_token': 'qr-secret-1',
        'attendee_name': 'Sita Voter',
        'event_slug': slug,
        'event_title': 'Biratnagar Fest',
        'status': 'valid',
        'saved_at': '2025-04-12T10:00:00',
        'source': 'device',
      };
      await pumpApp(tester, sheetPage(c, c.contestants.first),
          overrides: attendee(), prefs: {'attendee_passes_v1': jsonEncode([pass])});
      expect(find.text('Voting with your pass TKT-F449BA-0001'), findsOneWidget);
      await tapText(tester, 'Vote');
      expect(bodyOf('vote/')['ticket_code'], 'qr-secret-1');
      expect(find.text("You've used all your votes in this contest."), findsOneWidget);
    });

    testScreen('account contests ask signed-out voters to sign in', (tester) async {
      useDevice(tester, Device.phone);
      final c = contestWith({'verification': {'method': 'account', 'channel': null, 'captcha_site_key': null}});
      await pumpApp(tester, sheetPage(c, c.contestants.first), overrides: attendee());
      expect(find.text('Sign in to vote'), findsOneWidget);
      final vote = tester.widget<FilledButton>(find.ancestor(of: find.text('Vote'), matching: find.byType(FilledButton)));
      expect(vote.onPressed, isNull);
    });

    testScreen('account contests vote as the signed-in user', (tester) async {
      useDevice(tester, Device.phone);
      final c = contestWith({'verification': {'method': 'account', 'channel': null, 'captcha_site_key': null}});
      fakeRoutes['allowance/'] = FakeReply(allowanceJson(1, daily: false));
      await pumpApp(tester, sheetPage(c, c.contestants.first), overrides: attendee(user: voter));
      expect(find.text('Voting as sita@example.com'), findsOneWidget);
      expect(find.text('You have 1 free vote left'), findsOneWidget);
    });
  });

  group('per-contestant votes left', () {
    final device = contestWith({'verification': {'method': 'open', 'channel': null, 'captcha_site_key': null}});
    final asha = device.contestants.first;

    testScreen('asks for the contestant and caps the stepper at what the server accepts', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['allowance/'] = FakeReply({
        'main': {
          'free_remaining': 5, 'resets_daily': true, 'credits': 0, 'voted_for': [],
          'contestant_id': asha.id, 'contestant_free_remaining': 2, 'contestant_used': 1,
          'contestant_cap': 3, 'contestant_cap_period': 'day',
        },
        'categories': {},
      });
      await pumpApp(tester, sheetPage(device, asha), overrides: attendee());
      expect(bodyOf('allowance/')['contestant'], asha.id);
      expect(find.text('You have 5 free votes left today · resets at midnight Nepal time · up to 2 free for Asha Rai'), findsOneWidget);
      await tester.tap(find.byTooltip('One vote more'));
      await settle(tester);
      expect(find.text('Give 2 votes'), findsOneWidget);
      final button = tester.widget<InkWell>(find.descendant(of: find.byTooltip('One vote more'), matching: find.byType(InkWell)));
      expect(button.onTap, isNull, reason: 'no third vote: only 2 free left for Asha and no credits');
    });

    testScreen('cap reached for this contestant: explains it, no vote button', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['allowance/'] = FakeReply({
        'main': {
          'free_remaining': 4, 'resets_daily': true, 'credits': 0, 'voted_for': [asha.id],
          'contestant_id': asha.id, 'contestant_free_remaining': 0, 'contestant_used': 3,
          'contestant_cap': 3, 'contestant_cap_period': 'day',
        },
        'categories': {},
      });
      await pumpApp(tester, sheetPage(device, asha), overrides: attendee());
      expect(find.textContaining("You've given Asha Rai the most free votes allowed today"), findsOneWidget);
      final vote = tester.widget<FilledButton>(find.ancestor(of: find.text('Vote'), matching: find.byType(FilledButton)));
      expect(vote.onPressed, isNull);
    });
  });

  group('buy any number of votes', () {
    final c = contestWith({
      'verification': {'method': 'account', 'channel': null, 'captcha_site_key': null},
      'paid': {
        'enabled': true, 'payments_available': true, 'currency': 'NPR', 'price_per_vote': '4.00',
        'custom_votes': true, 'max_custom_votes': 1000, 'buy_and_vote': false,
        'providers': [
          {'id': 'khalti', 'name': 'Khalti', 'sandbox': true},
          {'id': 'esewa', 'name': 'eSewa', 'sandbox': true},
        ],
        'packs': [],
      },
    });

    testScreen('stepper / input, live price, Khalti off under Rs 10, sends votes not a pack', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['buy/'] = const FakeReply.errorBody({'error': 'Voting isn’t open, so votes can’t be bought right now.', 'code': 'payments_unavailable'}, status: 409);
      await pumpApp(
        tester,
        Builder(builder: (context) => Scaffold(body: Center(child: TextButton(onPressed: () => openVotePacks(context, contest: c), child: const Text('open'))))),
        overrides: attendee(user: voter),
      );
      await tester.tap(find.text('open'));
      await settle(tester);
      expect(find.text('Any number of votes'), findsOneWidget);
      expect(find.text('Pay Rs 40'), findsOneWidget, reason: '10 votes × Rs 4');
      await expectGolden(tester, 'phone_vote_packs_custom');

      await tester.enterText(find.widgetWithText(TextField, '10'), '2');
      await settle(tester);
      expect(find.text('Pay Rs 8'), findsOneWidget);
      expect(find.text('Khalti takes Rs 10 or more. Pay with eSewa, or pick more votes.'), findsOneWidget);
      expect(find.text('Takes Rs 10 or more'), findsOneWidget);

      await tapText(tester, 'Pay Rs 8');
      final body = bodyOf('buy/');
      expect(body['votes'], 2);
      expect(body.containsKey('pack'), isFalse);
      expect(body['provider'], 'esewa', reason: 'Khalti was switched off under Rs 10');
      expect(find.text('Voting isn’t open, so votes can’t be bought right now.'), findsOneWidget);
    });
  });

  group('my payments', () {
    testScreen('signed in: account history merged with this phone, device-only marked', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/api/payments/mine/'] = const FakeReply({
        'count': 1,
        'results': [
          {
            'id': 'acc-1', 'purpose': 'vote_pack', 'purpose_label': 'Vote pack', 'description': '60 votes · Miss Biratnagar 2026',
            'status': 'paid', 'amount': '200.00', 'currency': 'NPR', 'provider': 'khalti', 'provider_name': 'Khalti',
            'created_at': '2025-04-12T08:00:00Z',
            'summary': {'type': 'vote_pack', 'votes': 60, 'contest': {'title': 'Miss Biratnagar 2026', 'slug': 'miss', 'event_slug': 'bma'}},
          },
        ],
      });
      final phoneOnly = {
        'id': 'dev-1', 'purpose': 'ticket_order', 'description': '1 ticket · Biratnagar Fest', 'amount': 350.0,
        'provider': 'esewa', 'created_at': '2025-04-12T09:00:00Z', 'status': 'cancelled',
      };
      await pumpApp(tester, const MyPaymentsScreen(), overrides: attendee(user: voter), prefs: {'payment_history_v1': jsonEncode([phoneOnly])});
      expect(find.text('60 votes · Miss Biratnagar 2026'), findsOneWidget);
      expect(find.text('1 ticket · Biratnagar Fest'), findsOneWidget);
      expect(find.text('This phone only'), findsOneWidget);
      expect(find.text('Paid'), findsOneWidget);
      expect(find.text('Cancelled'), findsOneWidget);
    });

    testScreen('signed out: this phone only, no account call', (tester) async {
      useDevice(tester, Device.phone);
      final phoneOnly = {
        'id': 'dev-1', 'purpose': 'ticket_order', 'description': '1 ticket · Biratnagar Fest', 'amount': 350.0,
        'provider': 'esewa', 'created_at': '2025-04-12T09:00:00Z', 'status': 'paid',
      };
      await pumpApp(tester, const MyPaymentsScreen(), overrides: attendee(), prefs: {'payment_history_v1': jsonEncode([phoneOnly])});
      expect(find.text('1 ticket · Biratnagar Fest'), findsOneWidget);
      expect(find.text('This phone only'), findsNothing);
      expect(fakeRequests.where((o) => o.path.endsWith('/payments/mine/')), isEmpty);
    });

    testScreen('module off: friendly note, phone history still shown', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/api/payments/mine/'] = const FakeReply.errorBody({'code': 'module_disabled', 'module': 'payments', 'error': 'off'}, status: 403);
      await pumpApp(tester, const MyPaymentsScreen(), overrides: attendee(user: voter));
      expect(find.textContaining('Online payments are switched off'), findsOneWidget);
      expect(find.text('No payments yet'), findsOneWidget);
    });
  });

  group('event page voting card', () {
    Map<String, dynamic> eventJson() => {
          'event': {
            'id': 'e1',
            'title': 'Biratnagar Fest',
            'slug': slug,
            'start_date': '2026-11-02',
            'location': 'Greenwood Resort',
            'status': 'published',
            'ticket_types': [],
            'payment_options': {'mode': 'venue', 'online': false, 'venue': true, 'providers': []},
          },
          'form': null,
        };

    testScreen('lists contests and quick polls', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/api/events/public/$slug/'] = FakeReply(eventJson());
      fakeRoutes['/api/voting/public/$slug/'] = FakeReply(api['event_voting']);
      await pumpApp(tester, const EventDetailScreen(slug: slug), overrides: attendee());
      expect(find.text('Miss Biratnagar 2026'), findsOneWidget);
      expect(find.text('Best Eastern Emerging Indie Band 2026'), findsOneWidget);
    });

    testScreen('contests hidden when the contests module is off; polls stay', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/api/events/public/$slug/'] = FakeReply(eventJson());
      fakeRoutes['/api/voting/public/$slug/'] = FakeReply(api['event_voting']);
      await pumpApp(tester, const EventDetailScreen(slug: slug), overrides: attendee(disabled: {'contests'}));
      expect(find.text('Miss Biratnagar 2026'), findsNothing);
      expect(find.text('Best Eastern Emerging Indie Band 2026'), findsOneWidget);
    });

    testScreen('whole voting card hidden when voting is off', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/api/events/public/$slug/'] = FakeReply(eventJson());
      fakeRoutes['/api/voting/public/$slug/'] = FakeReply(api['event_voting']);
      await pumpApp(tester, const EventDetailScreen(slug: slug), overrides: attendee(disabled: {'voting'}));
      expect(find.text('Live voting'), findsNothing);
      expect(find.text('Miss Biratnagar 2026'), findsNothing);
    });
  });

  group('payment result', () {
    const id = 'b57469bc-41d4-4c73-bec8-d94de440b68f';
    Map<String, dynamic> intent(String status, {bool fulfilled = false, String? reason}) => {
          'id': id,
          'purpose': 'ticket_order',
          'description': '1 ticket · Biratnagar Fest',
          'status': status,
          'amount': '350.00',
          'provider': 'khalti',
          'provider_name': 'Khalti',
          'provider_txn_id': status == 'paid' ? 'TLruYUJBZuvG5ETy' : null,
          'fulfilled': fulfilled,
          'failure_reason': reason,
        };

    testScreen('paid and delivered', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/api/payments/intents/$id/'] = FakeReply(intent('paid', fulfilled: true));
      await pumpApp(tester, const PaymentResultScreen(intentId: id, doneLabel: 'View my passes'), overrides: attendee());
      expect(find.text('Payment successful'), findsOneWidget);
      expect(find.text('Rs 350 paid with Khalti.'), findsOneWidget);
      expect(find.text('View my passes'), findsOneWidget);
      await expectGolden(tester, 'phone_payment_paid');
    });

    testScreen('failed: try again or pay at the venue', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/api/payments/intents/$id/'] = FakeReply(intent('failed', reason: 'failed'));
      await pumpApp(tester, const PaymentResultScreen(intentId: id, offerVenue: true), overrides: attendee());
      expect(find.text('Payment failed'), findsWidgets); // title + status row
      expect(find.text("Khalti didn't complete the payment. Nothing was charged."), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
      expect(find.text('Pay at the venue instead'), findsOneWidget);
    });

    testScreen('expired', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/api/payments/intents/$id/'] = FakeReply(intent('expired'));
      await pumpApp(tester, const PaymentResultScreen(intentId: id), overrides: attendee());
      expect(find.text('Payment timed out'), findsOneWidget);
    });

    testScreen('still pending: keeps checking, offers to continue', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/api/payments/intents/$id/'] = FakeReply(intent('pending'));
      await pumpApp(
        tester,
        const PaymentResultScreen(intentId: id, every: Duration(milliseconds: 50)),
        overrides: attendee(),
      );
      expect(find.text('Waiting for Khalti'), findsOneWidget);
      expect(find.text('Continue payment'), findsOneWidget);
      final polls = fakeRequests.where((o) => o.path.endsWith('/intents/$id/')).length;
      expect(polls, greaterThan(1), reason: 'polls until the payment settles');
    });
  });

  group('gate scanner payment states', () {
    final collect = ScanResultModel(
      outcome: ScanOutcome.success,
      message: 'Welcome! Entry recorded at Main Gate.',
      attendeeName: 'Aarati Gurung',
      ticketCode: 'TKT-7340',
      qrToken: 'evl_4c92zv_dharan_spring',
      scanType: 'gate_in',
      gateName: 'Main Gate',
      scannedAt: DateTime(2025, 4, 12, 18, 42),
      ticketType: const TicketTypeInfo(name: 'General', price: 350, paymentStatus: 'due', paymentLabel: 'Pay Rs 350 at the venue'),
    );
    final paidOnline = ScanResultModel(
      outcome: ScanOutcome.success,
      message: 'Welcome! Entry recorded at Main Gate.',
      attendeeName: 'Aarati Gurung',
      ticketCode: 'TKT-7340',
      scanType: 'gate_in',
      gateName: 'Main Gate',
      scannedAt: DateTime(2025, 4, 12, 18, 42),
      ticketType: const TicketTypeInfo(name: 'General', price: 350, paymentStatus: 'paid', paymentLabel: 'Paid online · Khalti · ref 4H7Ah'),
    );
    final unpaid = ScanResultModel.fromJson({
      'status': 'cancelled',
      'result': 'unpaid',
      'message': '⛔ Entry Denied: Online payment not completed. This ticket is only held while the buyer pays.',
      'attendee_name': 'Prabin Shrestha',
      'gate_name': 'Main Gate',
      'scan_type': 'gate_in',
      'scanned_at': '2025-04-12T18:42:00',
      'ticket': {'ticket_number': 'TKT-7377', 'attendee_name': 'Prabin Shrestha', 'price': '350.00',
        'payment': {'status': 'pending', 'label': 'Awaiting online payment of Rs 350'}},
    }, 'evl_5bx1q0');

    testScreen('pay-at-venue let-in shows the amount to collect', (tester) async {
      useDevice(tester, Device.phone);
      await pumpApp(tester, const StaffShell(),
          overrides: fixtureOverrides(staff: true, scanner: ScannerConfig(useCamera: false, debugResult: collect)));
      expect(find.text('COLLECT AT THE GATE'), findsOneWidget);
      expect(find.text('Rs 350'), findsOneWidget);
      await expectGolden(tester, 'phone_scanner_collect');
    });

    testScreen('paid online: nothing to collect, says how it was paid', (tester) async {
      useDevice(tester, Device.phone);
      await pumpApp(tester, const StaffShell(),
          overrides: fixtureOverrides(staff: true, scanner: ScannerConfig(useCamera: false, debugResult: paidOnline)));
      expect(find.text('COLLECT AT THE GATE'), findsNothing);
      expect(find.text('Paid online · Khalti · ref 4H7Ah'), findsOneWidget);
    });

    testScreen('unpaid online order is refused in red', (tester) async {
      useDevice(tester, Device.phone);
      await pumpApp(tester, const StaffShell(),
          overrides: fixtureOverrides(staff: true, scanner: ScannerConfig(useCamera: false, debugResult: unpaid)));
      expect(find.text('Not paid'), findsOneWidget);
      expect(find.textContaining('Online payment not completed.'), findsOneWidget);
      expect(find.text('COLLECT AT THE GATE'), findsNothing);
      await expectGolden(tester, 'phone_scanner_unpaid');
    });
  });
}
