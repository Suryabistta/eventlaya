import 'package:eventlaya_scanner/core/legal.dart';
import 'package:eventlaya_scanner/ui/ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

/// Records what the app asked url_launcher to open.
class _FakeLauncher extends UrlLauncherPlatform with MockPlatformInterfaceMixin {
  final opened = <(String, PreferredLaunchMode)>[];

  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> canLaunch(String url) async => true;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    opened.add((url, options.mode));
    return true;
  }
}

Future<void> _pump(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(MaterialApp(
    theme: AppTheme.light,
    home: Scaffold(body: SingleChildScrollView(child: child)),
  ));
  await tester.pump();
}

void main() {
  late _FakeLauncher launcher;
  setUp(() {
    launcher = _FakeLauncher();
    UrlLauncherPlatform.instance = launcher;
  });

  test('legal pages live on the public website', () {
    expect(Legal.url(Legal.privacy).toString(), 'https://eventlaya.com/privacy');
    expect(Legal.url(Legal.terms).toString(), 'https://eventlaya.com/terms');
    expect(Legal.url(Legal.deleteAccount).toString(), 'https://eventlaya.com/delete-account');
    expect(Legal.supportEmail, 'support@eventlaya.com');
  });

  testWidgets('Privacy & support rows open the pages in an in-app browser tab and email support', (tester) async {
    await _pump(tester, const LegalSection());
    for (final row in ['Privacy policy', 'Terms of service', 'Delete account info', 'Contact support']) {
      expect(find.text(row), findsOneWidget, reason: row);
    }

    await tester.tap(find.text('Privacy policy'));
    await tester.tap(find.text('Terms of service'));
    await tester.tap(find.text('Delete account info'));
    await tester.tap(find.text('Contact support'));
    await tester.pump();

    expect(launcher.opened.map((o) => o.$1).toList(), [
      'https://eventlaya.com/privacy',
      'https://eventlaya.com/terms',
      'https://eventlaya.com/delete-account',
      'mailto:support@eventlaya.com?subject=Eventlaya%20app',
    ]);
    expect(launcher.opened.take(3).every((o) => o.$2 == PreferredLaunchMode.inAppBrowserView), isTrue);
  });

  testWidgets('without the delete info row', (tester) async {
    await _pump(tester, const LegalSection(deleteInfo: false));
    expect(find.text('Delete account info'), findsNothing);
    expect(find.text('Privacy policy'), findsOneWidget);
  });

  testWidgets('consent text links to the Terms and the Privacy policy', (tester) async {
    await _pump(tester, const LegalConsentText(lead: 'By creating an account you agree to the'));
    expect(find.textContaining('By creating an account you agree to the', findRichText: true), findsOneWidget);
    await tester.tap(find.text('Terms of service'));
    await tester.tap(find.text('Privacy policy'));
    await tester.pump();
    expect(launcher.opened.map((o) => o.$1), ['https://eventlaya.com/terms', 'https://eventlaya.com/privacy']);
  });
}
