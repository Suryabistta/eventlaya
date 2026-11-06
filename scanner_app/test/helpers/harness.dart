import 'dart:io';
import 'package:clock/clock.dart';
import 'package:dio/dio.dart';
import 'package:eventlaya_scanner/core/api_client.dart';
import 'package:eventlaya_scanner/models/gate_model.dart';
import 'package:eventlaya_scanner/providers/auth_provider.dart';
import 'package:eventlaya_scanner/screens/common/session_guard.dart';
import 'package:eventlaya_scanner/providers/event_provider.dart';
import 'package:eventlaya_scanner/providers/scan_provider.dart';
import 'package:eventlaya_scanner/screens/staff/scanner_screen.dart';
import 'package:eventlaya_scanner/ui/ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'fixtures.dart';

/// A canned response for the fake API: JSON body, or an error.
class FakeReply {
  final Object? data;
  final int status;

  /// When true the request never completes (to capture loading states).
  final bool hang;
  const FakeReply(this.data, {this.status = 200, this.hang = false});
  const FakeReply.error(String message, {this.status = 500})
      : data = const {},
        hang = false;

  /// An error status with a JSON body (e.g. a 400 scan rejection).
  const FakeReply.errorBody(this.data, {required this.status}) : hang = false;
  const FakeReply.hang()
      : data = null,
        status = 200,
        hang = true;
}

/// Routes are matched by path suffix, e.g. '/tickets/' or 'gate/stats/'.
final Map<String, FakeReply> fakeRoutes = {};

/// Optional per-route handlers that can answer based on the request.
final Map<String, FakeReply Function(RequestOptions)> fakeHandlers = {};

/// Every request the fake API received in the current test.
final List<RequestOptions> fakeRequests = [];

void resetFakeRoutes() {
  fakeRequests.clear();
  fakeHandlers.clear();
  fakeRoutes
    ..clear()
    ..addAll({
      '/api/events/': FakeReply(Fx.events.map((e) => e.toJson()).toList()),
      '/gate/stats/': FakeReply(Fx.statsJson),
      '/tickets/': FakeReply(Fx.attendees),
      '/api/events/tasks/': FakeReply(Fx.tasks),
      '/api/events/staff-assign/': FakeReply(Fx.staffAssignments),
      '/api/auth/rbac/': FakeReply(Fx.rbac),
      '/gates/': FakeReply(Fx.gatesJson),
    });
}

void installFakeApi({bool withSessionHandling = false}) {
  final dio = Dio();
  dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
    fakeRequests.add(o);
    // Longest matching suffix wins.
    final keys = fakeRoutes.keys.where((k) => o.path.endsWith(k)).toList()
      ..sort((a, b) => b.length.compareTo(a.length));
    if (keys.isEmpty) {
      h.reject(DioException(
        requestOptions: o,
        response: Response(requestOptions: o, statusCode: 404, data: {'detail': 'Not found'}),
        type: DioExceptionType.badResponse,
      ));
      return;
    }
    final handler = fakeHandlers[keys.first];
    final r = handler != null ? handler(o) : fakeRoutes[keys.first]!;
    if (r.hang) return; // never completes
    if (r.status >= 400) {
      final body = (r.data is Map && (r.data as Map).isNotEmpty)
          ? r.data
          : {'detail': r.status == 401 ? 'Token is invalid or expired' : 'The server is not responding.'};
      h.reject(
        DioException(
          requestOptions: o,
          response: Response(requestOptions: o, statusCode: r.status, data: body),
          type: DioExceptionType.badResponse,
        ),
        true, // let the session (401) interceptor see it
      );
      return;
    }
    h.resolve(Response(requestOptions: o, statusCode: r.status, data: r.data));
  }));
  ApiClient.overrideWithDio(dio, withSessionHandling: withSessionHandling);
}

/// [testWidgets] with the clock pinned to [Fx.now], so phase badges, "ended"
/// banners, the greeting and "today" times render the same whatever the wall
/// clock says. (The app reads time through `clock.now()`.)
void testScreen(String description, WidgetTesterCallback callback) {
  testWidgets(description, (tester) => withClock(Clock.fixed(Fx.now), () => callback(tester)));
}

/// Whether the app currently holds the screen wakelock (see [installFakeWakelock]).
bool fakeWakelockEnabled = false;

/// Answers wakelock_plus's platform channel the way a device would, so screens
/// that keep the screen on (scanner, attendee pass) run in widget tests and the
/// test can check [fakeWakelockEnabled].
void installFakeWakelock() {
  const api = 'dev.flutter.pigeon.wakelock_plus_platform_interface.WakelockPlusApi';
  const codec = _WakelockCodec();
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  fakeWakelockEnabled = false;
  messenger.setMockMessageHandler('$api.toggle', (message) async {
    // Request is [ToggleMessage], which encodes as [enable].
    final args = codec.decodeMessage(message) as List<Object?>;
    fakeWakelockEnabled = (args.first as List<Object?>).first == true;
    return codec.encodeMessage(<Object?>[null]);
  });
  messenger.setMockMessageHandler('$api.isEnabled', (message) async {
    return codec.encodeMessage(<Object?>[_IsEnabledReply(fakeWakelockEnabled)]);
  });
}

class _IsEnabledReply {
  final bool enabled;
  const _IsEnabledReply(this.enabled);
}

/// Mirrors wakelock_plus's pigeon codec: 129 = ToggleMessage, 130 = IsEnabledMessage,
/// each carried as a list of its fields.
class _WakelockCodec extends StandardMessageCodec {
  const _WakelockCodec();

  @override
  void writeValue(WriteBuffer buffer, Object? value) {
    if (value is _IsEnabledReply) {
      buffer.putUint8(130);
      writeValue(buffer, <Object?>[value.enabled]);
    } else {
      super.writeValue(buffer, value);
    }
  }

  @override
  Object? readValueOfType(int type, ReadBuffer buffer) =>
      type == 129 || type == 130 ? readValue(buffer) : super.readValueOfType(type, buffer);
}

String? _flutterRoot() {
  final env = Platform.environment['FLUTTER_ROOT'];
  if (env != null) return env;
  for (final p in [
    '${Platform.environment['HOME']}/snap/flutter/common/flutter',
    '${Platform.environment['HOME']}/flutter-sdk',
  ]) {
    if (Directory(p).existsSync()) return p;
  }
  return null;
}

Future<void> _load(String family, List<String> files) async {
  final loader = FontLoader(family);
  for (final f in files) {
    final bytes = File(f).readAsBytesSync();
    loader.addFont(Future.value(bytes.buffer.asByteData(bytes.offsetInBytes, bytes.lengthInBytes)));
  }
  await loader.load();
}

/// Loads the real app fonts (and Material icons) so goldens show real text.
Future<void> loadAppFonts() async {
  GoogleFonts.config.allowRuntimeFetching = false;
  const dir = 'assets/google_fonts';
  final families = {
    'BricolageGrotesque': {'500': 'Medium', '600': 'SemiBold', '700': 'Bold', '800': 'ExtraBold'},
    'Poppins': {'regular': 'Regular', '500': 'Medium', '600': 'SemiBold', '700': 'Bold'},
    'JetBrainsMono': {'regular': 'Regular', '500': 'Medium', '600': 'SemiBold', '700': 'Bold'},
  };
  for (final entry in families.entries) {
    final all = <String>[];
    for (final v in entry.value.entries) {
      final path = '$dir/${entry.key}-${v.value}.ttf';
      all.add(path);
      // google_fonts registers each weight as "<Family>_<variant>".
      await _load('${entry.key}_${v.key}', [path]);
    }
    await _load(entry.key, all);
  }
  final root = _flutterRoot();
  if (root != null) {
    final icons = '$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf';
    if (File(icons).existsSync()) await _load('MaterialIcons', [icons]);
  }
}

enum Device { phone, tablet }

extension DeviceSpec on Device {
  Size get size => this == Device.phone ? const Size(390, 844) : const Size(1024, 768);
  String get tag => name;
}

/// Sets up a test screen at the device size with realistic safe areas.
void useDevice(WidgetTester tester, Device device) {
  const dpr = 2.0;
  tester.view.devicePixelRatio = dpr;
  tester.view.physicalSize = device.size * dpr;
  tester.view.padding = device == Device.phone
      ? const FakeViewPadding(top: 47 * dpr, bottom: 34 * dpr)
      : const FakeViewPadding(top: 24 * dpr, bottom: 20 * dpr);
  tester.view.viewPadding = tester.view.padding;
  addTearDown(tester.view.reset);
}

/// Provider overrides with fixture data.
List<Override> fixtureOverrides({
  bool staff = false,
  bool withEvent = true,
  GateModel? gate,
  bool gateLocked = false,
  ScanState scanState = const ScanState(),
  ScannerConfig scanner = const ScannerConfig(useCamera: false),
}) {
  return [
    authProvider.overrideWith((ref) => AuthNotifier(AuthState(user: staff ? Fx.staff : Fx.organizer))),
    eventProvider.overrideWith((ref) => EventNotifier(withEvent
        ? EventState(
            currentEvent: Fx.event,
            selectedGate: (gate ?? Fx.mainGate).name,
            gate: gate ?? Fx.mainGate,
            gateLocked: gateLocked,
            stats: Fx.stats,
          )
        : const EventState(selectedGate: 'Main Gate'))),
    eventsProvider.overrideWith((ref) async => Fx.events),
    scanProvider.overrideWith((ref) => ScanNotifier(initial: scanState, listenConnectivity: false)),
    scannerConfigProvider.overrideWithValue(scanner),
  ];
}

Future<void> pumpApp(
  WidgetTester tester,
  Widget home, {
  List<Override> overrides = const [],
  Map<String, Object> prefs = const {},
}) async {
  SharedPreferences.setMockInitialValues({'server_url': 'https://gate.eventlaya.com', ...prefs});
  await tester.pumpWidget(ProviderScope(
    overrides: overrides,
    child: MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      navigatorKey: appNavigatorKey,
      builder: (context, child) => SessionGuard(child: child ?? const SizedBox()),
      home: home,
    ),
  ));
  await settle(tester);
}

/// Lets async work (asset loads, fake API, fonts, svg) finish and frames settle.
Future<void> settle(WidgetTester tester, {int rounds = 4}) async {
  for (var i = 0; i < rounds; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
    await tester.pump(const Duration(milliseconds: 400));
  }
}

Future<void> expectGolden(WidgetTester tester, String name) async {
  await expectLater(find.byType(MaterialApp), matchesGoldenFile('../goldens/$name.png'));
}
