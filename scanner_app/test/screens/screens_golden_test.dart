// Golden screenshots of the main screens at phone (390x844) and tablet
// (1024x768) sizes, using real fonts and fixture data.
//
// Regenerate with: flutter test --update-goldens test/screens
import 'package:clock/clock.dart';
import 'package:eventlaya_scanner/models/event_model.dart';
import 'package:eventlaya_scanner/models/scan_result_model.dart';
import 'package:eventlaya_scanner/providers/scan_provider.dart';
import 'package:eventlaya_scanner/screens/admin/admin_shell.dart';
import 'package:eventlaya_scanner/screens/admin/staff_screen.dart';
import 'package:eventlaya_scanner/screens/common/pickers.dart';
import 'package:eventlaya_scanner/screens/login_screen.dart';
import 'package:eventlaya_scanner/screens/staff/gate_select_screen.dart';
import 'package:eventlaya_scanner/screens/staff/scanner_screen.dart';
import 'package:eventlaya_scanner/screens/staff/staff_shell.dart';
import 'package:eventlaya_scanner/ui/ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../helpers/fixtures.dart';
import '../helpers/harness.dart';

void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    await loadAppFonts();
    installFakeApi();
  });

  setUp(() {
    resetFakeRoutes();
    installFakeWakelock();
  });

  for (final device in Device.values) {
    final d = device.tag;

    group(d, () {
      testScreen('login', (tester) async {
        useDevice(tester, device);
        await pumpApp(tester, const LoginScreen(), overrides: fixtureOverrides());
        await expectGolden(tester, '${d}_login');
      });

      testScreen('gate select', (tester) async {
        useDevice(tester, device);
        await pumpApp(tester, const GateSelectScreen(),
            overrides: fixtureOverrides(staff: true, withEvent: false));
        await expectGolden(tester, '${d}_gate_select');
      });

      testScreen('scanner idle', (tester) async {
        useDevice(tester, device);
        await pumpApp(tester, const StaffShell(),
            overrides: fixtureOverrides(staff: true, scanState: const ScanState(offlineQueueCount: 3)));
        expect(fakeWakelockEnabled, isTrue); // screen stays on while scanning
        await expectGolden(tester, '${d}_scanner_idle');
      });

      final results = <String, ScanResultModel>{
        'let_in': Fx.letIn,
        'already_inside': Fx.alreadyInside,
        'not_found': Fx.notFound,
        'not_checked_in': Fx.notCheckedIn,
      };
      for (final r in results.entries) {
        testScreen('scanner ${r.key}', (tester) async {
          useDevice(tester, device);
          await pumpApp(tester, const StaffShell(),
              overrides: fixtureOverrides(
                staff: true,
                scanner: ScannerConfig(useCamera: false, debugResult: r.value),
              ));
          await expectGolden(tester, '${d}_scanner_${r.key}');
        });
      }

      testScreen('recent scans', (tester) async {
        useDevice(tester, device);
        await pumpApp(tester, const StaffShell(initialIndex: StaffShell.recentTab),
            overrides: fixtureOverrides(
              staff: true,
              scanState: ScanState(history: [Fx.letIn, Fx.alreadyInside, Fx.notFound]),
            ));
        expect(fakeWakelockEnabled, isFalse); // scanner tab hidden, screen may sleep
        await expectGolden(tester, '${d}_recent_scans');
      });

      testScreen('admin home', (tester) async {
        useDevice(tester, device);
        await pumpApp(tester, const AdminShell(), overrides: fixtureOverrides());
        await expectGolden(tester, '${d}_admin_home');
      });

      testScreen('attendees', (tester) async {
        useDevice(tester, device);
        await pumpApp(tester, const AdminShell(initialIndex: AdminShell.attendeesTab),
            overrides: fixtureOverrides());
        await expectGolden(tester, '${d}_attendees');
      });

      testScreen('tasks', (tester) async {
        useDevice(tester, device);
        await pumpApp(tester, const AdminShell(initialIndex: AdminShell.tasksTab), overrides: fixtureOverrides());
        await expectGolden(tester, '${d}_tasks');
      });

      testScreen('more', (tester) async {
        useDevice(tester, device);
        await pumpApp(tester, const AdminShell(initialIndex: AdminShell.moreTab), overrides: fixtureOverrides());
        await expectGolden(tester, '${d}_more');
      });

      testScreen('ticket pass sheet', (tester) async {
        useDevice(tester, device);
        await pumpApp(tester, const AdminShell(initialIndex: AdminShell.attendeesTab),
            overrides: fixtureOverrides());
        await tester.tap(find.text('Aarati Gurung'));
        await settle(tester);
        expect(find.byType(TicketPass), findsOneWidget);
        await expectGolden(tester, '${d}_ticket_pass');
      });
    });
  }

  group('gates', () {
    testScreen('gate picker shows entry gates with VIP badge', (tester) async {
      useDevice(tester, Device.phone);
      await pumpApp(tester, const StaffShell(), overrides: fixtureOverrides(staff: true));
      await tester.tap(find.text('Main Gate').first);
      await settle(tester);
      expect(find.byType(GateList), findsOneWidget);
      expect(find.text('VIP Entrance'), findsOneWidget);
      expect(find.text('North Exit'), findsNothing); // exit-only hidden in gate-in mode
      expect(find.text('Old Side Gate'), findsNothing); // inactive
      await expectGolden(tester, 'phone_gate_picker');
    });

    testScreen('assigned gate is locked', (tester) async {
      useDevice(tester, Device.phone);
      await pumpApp(tester, const GateSelectScreen(),
          overrides: fixtureOverrides(staff: true, gate: Fx.vipGate, gateLocked: true));
      expect(find.text('Assigned by your organizer.'), findsOneWidget);
      await expectGolden(tester, 'phone_gate_select_locked');
    });

    testScreen('no gates set up', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/gates/'] = const FakeReply([]);
      await pumpApp(tester, const StaffShell(), overrides: fixtureOverrides(staff: true));
      expect(find.textContaining('Ask your organizer to set up gates'), findsOneWidget);
      await expectGolden(tester, 'phone_scanner_no_gates');
    });

    testScreen('exit-only locked gate starts in gate-out mode', (tester) async {
      useDevice(tester, Device.phone);
      await pumpApp(tester, const StaffShell(),
          overrides: fixtureOverrides(staff: true, gate: Fx.exitGate, gateLocked: true));
      await tester.tap(find.text('Gate in'));
      await tester.pump();
      expect(find.textContaining('exit only'), findsOneWidget); // warning toast
      await tester.pump(const Duration(seconds: 4)); // let the toast finish
      await settle(tester);
    });
  });

  group('gate staff', () {
    testScreen('staff grouped by gate', (tester) async {
      useDevice(tester, Device.phone);
      await pumpApp(tester, const StaffScreen(), overrides: fixtureOverrides());
      expect(find.text('Unassigned'), findsOneWidget);
      expect(find.text('Sarita Dahal'), findsOneWidget);
      expect(find.text('No staff yet'), findsOneWidget); // North Exit
      await expectGolden(tester, 'phone_gate_staff');
    });

    testScreen('adding staff sends the chosen gate_id', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/api/events/staff-assign/'] = FakeReply(Fx.staffAssignments);
      await pumpApp(tester, const StaffScreen(), overrides: fixtureOverrides());
      await tester.tap(find.byTooltip('Add gate staff'));
      await settle(tester);
      await tester.enterText(find.widgetWithText(TextField, 'Email'), 'new@purbanchal.events');
      await tester.tap(find.text('VIP Entrance').last);
      await tester.pump();
      await tester.tap(find.text('Add to gate'));
      await settle(tester);
      final post = fakeRequests.lastWhere((r) => r.method == 'POST' && r.path.endsWith('/staff-assign/'));
      final body = post.data as Map;
      expect(body['gate_id'], 'g-vip');
      expect(body['staff_email'], 'new@purbanchal.events');
      expect(body.containsKey('gate_name'), isFalse);
      await tester.pump(const Duration(seconds: 4));
      await settle(tester);
    });

    testScreen('no gates points to the web dashboard', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/gates/'] = const FakeReply([]);
      await pumpApp(tester, const StaffScreen(), overrides: fixtureOverrides());
      expect(find.text('Set up gates on the web dashboard (Gates & staff).'), findsOneWidget);
      expect(find.byTooltip('Add gate staff'), findsNothing);
    });
  });

  group('session', () {
    testScreen('401 after failed refresh returns to login with a toast', (tester) async {
      useDevice(tester, Device.phone);
      installFakeApi(withSessionHandling: true);
      addTearDown(installFakeApi);
      fakeRoutes['/tickets/'] = const FakeReply.error('expired', status: 401);
      fakeRoutes['/api/auth/refresh/'] = const FakeReply.error('expired', status: 401);
      await pumpApp(
        tester,
        const AdminShell(initialIndex: AdminShell.attendeesTab),
        overrides: fixtureOverrides(),
        prefs: {'auth_token': 'old', 'refresh_token': 'old-refresh'},
      );
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.text('Your session ended. Sign in again.'), findsOneWidget);
      expect(fakeRequests.any((r) => r.path.endsWith('/api/auth/refresh/')), isTrue);
      await tester.pump(const Duration(seconds: 4));
      await settle(tester);
    });

    testScreen('401 with a working refresh retries the request', (tester) async {
      useDevice(tester, Device.phone);
      installFakeApi(withSessionHandling: true);
      addTearDown(installFakeApi);
      var calls = 0;
      fakeRoutes['/api/auth/refresh/'] = const FakeReply({'access': 'new-token'});
      // Old token gets 401; the refreshed token succeeds.
      fakeHandlers['/tickets/'] = (o) => o.headers['Authorization'] == 'Bearer new-token'
          ? FakeReply(Fx.attendees)
          : const FakeReply.error('expired', status: 401);
      await pumpApp(
        tester,
        const AdminShell(initialIndex: AdminShell.attendeesTab),
        overrides: fixtureOverrides(),
        prefs: {'auth_token': 'old', 'refresh_token': 'old-refresh'},
      );
      calls = fakeRequests.where((r) => r.path.endsWith('/tickets/')).length;
      expect(calls, 2); // original + one retry, no loop
      expect(find.byType(LoginScreen), findsNothing);
      expect(find.text('Aarati Gurung'), findsOneWidget);
    });
  });

  group('states', () {
    testScreen('attendees error', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/tickets/'] = const FakeReply.error('down');
      await pumpApp(tester, const AdminShell(initialIndex: AdminShell.attendeesTab),
          overrides: fixtureOverrides());
      expect(find.text('Try again'), findsOneWidget);
      await expectGolden(tester, 'phone_attendees_error');
    });

    testScreen('attendees loading', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/tickets/'] = const FakeReply.hang();
      await pumpApp(tester, const AdminShell(initialIndex: AdminShell.attendeesTab),
          overrides: fixtureOverrides());
      expect(find.byType(LoadingList), findsOneWidget);
      await expectGolden(tester, 'phone_attendees_loading');
    });

    testScreen('tasks empty', (tester) async {
      useDevice(tester, Device.phone);
      fakeRoutes['/api/events/tasks/'] = const FakeReply([]);
      await pumpApp(tester, const AdminShell(initialIndex: AdminShell.tasksTab), overrides: fixtureOverrides());
      expect(find.text('Add a task'), findsOneWidget);
      await expectGolden(tester, 'phone_tasks_empty');
    });

    testScreen('large text on admin home', (tester) async {
      useDevice(tester, Device.phone);
      tester.platformDispatcher.textScaleFactorTestValue = 1.3;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await pumpApp(tester, const AdminShell(), overrides: fixtureOverrides());
      await expectGolden(tester, 'phone_admin_home_text130');
    });
  });

  group('behaviour', () {
    testScreen('runs at the pinned fixture time, not the wall clock', (tester) async {
      // testScreen pins the clock; goldens depend on it.
      expect(clock.now(), Fx.now);
      expect(Fx.event.phase, EventPhase.live);
      expect(Fx.event2.phase, EventPhase.upcoming);
    });

    testScreen('tabs keep their state when switching', (tester) async {
      useDevice(tester, Device.phone);
      await pumpApp(tester, const AdminShell(initialIndex: AdminShell.attendeesTab),
          overrides: fixtureOverrides());
      await tester.enterText(find.byType(TextField).first, 'Aarati');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tap(find.text('Home').last);
      await settle(tester);
      await tester.tap(find.text('Attendees').last);
      await settle(tester);
      expect(find.widgetWithText(TextField, 'Aarati'), findsOneWidget);
    });

    testScreen('tablet uses a sidebar instead of the tab bar', (tester) async {
      useDevice(tester, Device.tablet);
      await pumpApp(tester, const AdminShell(), overrides: fixtureOverrides());
      expect(find.byType(SideBar), findsOneWidget);
      expect(find.byType(FrostedTabBar), findsNothing);
    });

    testScreen('phone uses the frosted tab bar', (tester) async {
      useDevice(tester, Device.phone);
      await pumpApp(tester, const AdminShell(), overrides: fixtureOverrides());
      expect(find.byType(FrostedTabBar), findsOneWidget);
      expect(find.byType(SideBar), findsNothing);
    });

    testScreen('task path uses the /api prefix', (tester) async {
      useDevice(tester, Device.phone);
      await pumpApp(tester, const AdminShell(initialIndex: AdminShell.tasksTab), overrides: fixtureOverrides());
      expect(find.text('Charge backup batteries for gate scanners'), findsOneWidget);
    });
  });
}
