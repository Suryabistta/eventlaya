import 'package:eventlaya_scanner/core/offline_queue.dart';
import 'package:eventlaya_scanner/models/scan_result_model.dart';
import 'package:eventlaya_scanner/providers/scan_provider.dart';
import 'package:flutter_test/flutter_test.dart';
import '../helpers/harness.dart';

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();
    installFakeApi();
  });
  setUp(resetFakeRoutes);

  test('scan sends gate_id when a gate is selected', () async {
    fakeRoutes['/gate/scan/'] = const FakeReply({'status': 'gate_in', 'message': 'Welcome', 'attendee_name': 'Aarati'});
    final n = ScanNotifier(listenConnectivity: false);
    final r = await n.scan(qrToken: 'tok', scanType: 'gate_in', gateName: 'Main Gate', gateId: 'g-main', eventId: 'e1');
    expect(r.isSuccess, isTrue);
    final body = fakeRequests.last.data as Map;
    expect(body['gate_id'], 'g-main');
    expect(body['gate_name'], 'Main Gate');
    expect(n.state.history, hasLength(1));
  });

  test('legacy gate (no id) sends only gate_name', () async {
    fakeRoutes['/gate/scan/'] = const FakeReply({'status': 'gate_in', 'message': 'ok'});
    final n = ScanNotifier(listenConnectivity: false);
    await n.scan(qrToken: 'tok2', scanType: 'gate_in', gateName: 'Main Gate', eventId: 'e1');
    expect((fakeRequests.last.data as Map).containsKey('gate_id'), isFalse);
  });

  test('exit-only gate rejecting gate-in shows the server message', () async {
    fakeRoutes['/gate/scan/'] = const FakeReply.errorBody(
      {'status': 'wrong_gate', 'message': 'North Exit is exit only.'},
      status: 400,
    );
    final n = ScanNotifier(listenConnectivity: false);
    final r = await n.scan(qrToken: 'tok3', scanType: 'gate_in', gateName: 'North Exit', gateId: 'g-north', eventId: 'e1');
    expect(r.outcome, ScanOutcome.wrongEvent);
    expect(r.message, 'North Exit is exit only.');
  });

  test('invalid ticket (404 body) maps to ticket not found', () async {
    fakeRoutes['/gate/scan/'] = const FakeReply.errorBody({'status': 'invalid', 'message': 'Unknown QR'}, status: 404);
    final r = await ScanNotifier(listenConnectivity: false)
        .scan(qrToken: 'bad', scanType: 'gate_in', gateName: 'Main Gate', eventId: 'e1');
    expect(r.outcome, ScanOutcome.invalidToken);
  });

  test('offline scans keep the gate id', () {
    final s = OfflineScan(qrToken: 't', scanType: 'gate_out', gateName: 'North Exit', gateId: 'g-north', scannedAt: 'x', eventId: 'e');
    final json = s.toJson();
    expect(json['gate_id'], 'g-north');
    expect(OfflineScan.fromMap(json).gateId, 'g-north');
  });
}
