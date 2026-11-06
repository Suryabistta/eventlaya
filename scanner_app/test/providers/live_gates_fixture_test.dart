// Parses JSON recorded from the live backend (http://localhost:8000) for
// "Eastern Tech Fest & Hackathon 2026" so model changes are checked against
// the real API shape. Re-record with curl if the API changes.
import 'dart:convert';
import 'dart:io';
import 'package:eventlaya_scanner/providers/event_provider.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../helpers/harness.dart';

Object _load(String name) => jsonDecode(File('test/fixtures/$name').readAsStringSync());

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();
    installFakeApi();
  });
  setUp(() {
    resetFakeRoutes();
    SharedPreferences.setMockInitialValues({});
  });

  test('live gates response parses into ordered active gates', () async {
    fakeRoutes['/gates/'] = FakeReply(_load('live_gates_eastern_tech_fest.json'));
    final gates = await EventNotifier().fetchGates('0c4b6286-16dc-4a40-91b4-19a578257e30');
    expect(gates, isNotNull);
    expect(gates!.map((g) => g.name), ['Main Gate', 'Main North Gate', 'North Gate Scanner', 'VIP entrance', 'Exit B']);
    final vip = gates.firstWhere((g) => g.name == 'VIP entrance');
    expect(vip.isVip, isTrue);
    expect(vip.allows('gate_in'), isTrue);
    expect(vip.allows('gate_out'), isFalse);
    final exit = gates.firstWhere((g) => g.name == 'Exit B');
    expect(exit.kind, 'exit');
    expect(exit.allows('gate_in'), isFalse);
    final main = gates.first;
    expect(main.staff.single['staff_email'], 'staff@eventlaya.com');
    final north = gates[1];
    expect(north.scansInToday, 6);
    expect(north.scansOutToday, 1);
  });

  test('live my-assignment locks the staff gate', () async {
    fakeRoutes['/api/events/my-assignment/'] = FakeReply(_load('live_my_assignment_staff.json'));
    final n = EventNotifier();
    await n.loadAssignment();
    expect(n.state.currentEvent?.title, 'Eastern Tech Fest & Hackathon 2026');
    expect(n.state.gateLocked, isTrue);
    expect(n.state.gate?.id, '8b79e336-7750-4e59-b278-91b627e326b0');
    expect(n.state.selectedGate, 'Main Gate');
  });

  test('live staff-assign rows carry a gate object', () {
    final rows = _load('live_staff_assign_eastern_tech_fest.json') as List;
    expect((rows.first as Map)['gate']['id'], '8b79e336-7750-4e59-b278-91b627e326b0');
  });
}
