import 'package:eventlaya_scanner/models/app_user.dart';
import 'package:eventlaya_scanner/models/event_model.dart';
import 'package:eventlaya_scanner/models/gate_model.dart';
import 'package:eventlaya_scanner/models/gate_stats_model.dart';
import 'package:eventlaya_scanner/models/scan_result_model.dart';

/// Fixture data for screen tests. Dates are naive (local) so output is stable.
class Fx {
  /// The time screen tests run at (see testScreen in harness.dart): 18:45 on
  /// the day of [event], so it is live and the admin greeting is "Good evening".
  static final now = DateTime(2025, 4, 12, 18, 45);

  static final organizer = AppUser(
    id: 'u1',
    email: 'sushma@purbanchal.events',
    firstName: 'Sushma',
    lastName: 'Rai',
    role: UserRole.superadmin,
    organizationName: 'Purbanchal Events',
  );

  static final staff = AppUser(
    id: 'u2',
    email: 'bikash@purbanchal.events',
    firstName: 'Bikash',
    lastName: 'Limbu',
    role: UserRole.staff,
  );

  static final event = EventModel(
    id: '6f1c2b9e-1111-4c1a-9a51-0e5a2f1a0001',
    title: 'Dharan Spring Fest',
    slug: 'dharan-spring-fest',
    date: '2025-04-12T16:00:00',
    venue: 'Bhanu Chowk, Dharan',
    capacity: 600,
  );

  static final event2 = EventModel(
    id: '6f1c2b9e-2222-4c1a-9a51-0e5a2f1a0002',
    title: 'Itahari Tech Meetup',
    slug: 'itahari-tech-meetup',
    date: '2025-05-03T10:00:00',
    venue: 'Itahari Namuna College',
    capacity: 150,
  );

  static List<EventModel> get events => [event, event2];

  static List<Map<String, dynamic>> get gatesJson => [
        {'id': 'g-main', 'name': 'Main Gate', 'kind': 'both', 'is_vip': false, 'is_active': true, 'order': 1},
        {'id': 'g-vip', 'name': 'VIP Entrance', 'kind': 'entry', 'is_vip': true, 'is_active': true, 'order': 2},
        {'id': 'g-north', 'name': 'North Exit', 'kind': 'exit', 'is_vip': false, 'is_active': true, 'order': 3},
        {'id': 'g-old', 'name': 'Old Side Gate', 'kind': 'both', 'is_vip': false, 'is_active': false, 'order': 4},
      ];

  static GateModel get mainGate => GateModel.fromJson(gatesJson[0]);
  static GateModel get vipGate => GateModel.fromJson(gatesJson[1]);
  static GateModel get exitGate => GateModel.fromJson(gatesJson[2]);

  static const _names = [
    'Aarati Gurung',
    'Prabin Shrestha',
    'Sabina Tamang',
    'Rojan Karki',
    'Anisha Magar',
    'Kiran Rai',
    'Nabin Thapa',
    'Pooja Subba',
    'Sujan Limbu',
    'Rekha Yadav',
    'Dipesh Chaudhary',
    'Manisha Bhattarai',
  ];

  static List<Map<String, dynamic>> get recentScansJson => [
        for (var i = 0; i < 8; i++)
          {
            'id': 'log$i',
            'ticket_number': 'TKT-${(7340 + i * 37).toString()}',
            'attendee_name': _names[i],
            'scan_type': i % 3 == 2 ? 'gate_out' : 'gate_in',
            'result': i == 4 ? 'duplicate' : 'success',
            'gate_name': i.isEven ? 'Main Gate' : 'VIP Entrance',
            'scanned_at': '2025-04-12T18:${(42 - i * 3).toString().padLeft(2, '0')}:00',
          },
      ];

  static GateStatsModel get stats => GateStatsModel.fromJson({
        'capacity': 600,
        'total_registered': 486,
        'currently_inside': 271,
        'total_checked_in': 312,
        'total_checked_out': 41,
        'recent_scans': recentScansJson,
      });

  static Map<String, dynamic> get statsJson => {
        'capacity': 600,
        'total_registered': 486,
        'currently_inside': 271,
        'total_checked_in': 312,
        'total_checked_out': 41,
        'recent_scans': recentScansJson,
      };

  static List<Map<String, dynamic>> get attendees => [
        for (var i = 0; i < _names.length; i++)
          {
            'id': 't$i',
            'ticket_number': 'TKT-${(7340 + i * 37)}',
            'qr_token': 'evl_${(1000003 * (i + 7)).toRadixString(36)}_dharan_spring',
            'attendee_name': _names[i],
            'attendee_email': '${_names[i].split(' ').first.toLowerCase()}@gmail.com',
            'attendee_phone': '98420${(10000 + i * 731)}',
            'status': switch (i % 4) { 0 => 'checked_in', 1 => 'valid', 2 => 'checked_in', _ => 'checked_out' },
            'first_check_in': i % 4 == 1 ? null : '2025-04-12T17:${(10 + i).toString().padLeft(2, '0')}:00',
            'last_activity': '2025-04-12T18:${(5 + i).toString().padLeft(2, '0')}:00',
          },
      ];

  static List<Map<String, dynamic>> get tasks => [
        {
          'id': 'k1',
          'title': 'Charge backup batteries for gate scanners',
          'description': 'Two power banks per gate. Label them with the gate name.',
          'status': 'in_progress',
          'priority': 'urgent',
          'category': 'gate',
          'assigned_name': 'Ramesh (gate lead)',
        },
        {
          'id': 'k2',
          'title': 'Sound check with the opening band',
          'description': '',
          'status': 'todo',
          'priority': 'high',
          'category': 'stage',
          'assigned_name': 'Nima',
        },
        {
          'id': 'k3',
          'title': 'Water and snacks for volunteers',
          'description': 'Collect from the Bhanu Chowk store before 3 pm.',
          'status': 'todo',
          'priority': 'medium',
          'category': 'catering',
          'assigned_name': '',
        },
        {
          'id': 'k4',
          'title': 'Print VIP wristbands',
          'description': '',
          'status': 'completed',
          'priority': 'low',
          'category': 'hospitality',
          'assigned_name': 'Sabina',
        },
        {
          'id': 'k5',
          'title': 'Post the gate map on the event page',
          'description': 'Use the map from the venue team.',
          'status': 'todo',
          'priority': 'medium',
          'category': 'marketing',
          'assigned_name': 'Pooja',
        },
      ];

  static List<Map<String, dynamic>> get staffAssignments => [
        {
          'id': 'a1',
          'staff_name': 'Bikash Limbu',
          'staff_email': 'bikash@purbanchal.events',
          'gate_id': 'g-main',
          'gate_name': 'Main Gate',
          'gate': {'id': 'g-main', 'name': 'Main Gate', 'kind': 'both', 'is_vip': false},
        },
        {
          'id': 'a2',
          'staff_name': 'Sarita Dahal',
          'staff_email': 'sarita@purbanchal.events',
          'gate_id': 'g-vip',
          'gate_name': 'VIP Entrance',
          'gate': {'id': 'g-vip', 'name': 'VIP Entrance', 'kind': 'entry', 'is_vip': true},
        },
        {'id': 'a3', 'staff_name': 'Om Prakash', 'staff_email': 'om@purbanchal.events', 'gate_id': null, 'gate': null},
      ];

  static Map<String, dynamic> get rbac => {
        'modules': [
          {'name': 'Events', 'slug': 'events', 'is_globally_enabled': true},
          {'name': 'Gate scanner', 'slug': 'gate_scanner', 'is_globally_enabled': true},
          {'name': 'Registration forms', 'slug': 'dynamic_forms', 'is_globally_enabled': true},
          {'name': 'Live voting', 'slug': 'voting', 'is_globally_enabled': false},
          {'name': 'Venue marketplace', 'slug': 'marketplace', 'is_globally_enabled': true},
        ],
      };

  static final _at = DateTime(2025, 4, 12, 18, 42);

  static ScanResultModel get letIn => ScanResultModel(
        outcome: ScanOutcome.success,
        message: 'Welcome! Entry recorded at Main Gate.',
        attendeeName: 'Aarati Gurung',
        ticketCode: 'TKT-7340',
        qrToken: 'evl_4c92zv_dharan_spring',
        scanType: 'gate_in',
        gateName: 'Main Gate',
        scannedAt: _at,
      );

  static ScanResultModel get alreadyInside => ScanResultModel(
        outcome: ScanOutcome.alreadyIn,
        message: 'Checked in at 17:58 through VIP Entrance.',
        attendeeName: 'Prabin Shrestha',
        ticketCode: 'TKT-7377',
        qrToken: 'evl_5bx1q0_dharan_spring',
        scanType: 'gate_in',
        gateName: 'Main Gate',
        scannedAt: _at,
      );

  static ScanResultModel get notFound => ScanResultModel(
        outcome: ScanOutcome.invalidToken,
        message: 'This QR code does not match any ticket.',
        ticketCode: 'evl_zz91k2_unknown',
        qrToken: 'evl_zz91k2_unknown',
        scanType: 'gate_in',
        gateName: 'Main Gate',
        scannedAt: _at,
      );

  static ScanResultModel get notCheckedIn => ScanResultModel(
        outcome: ScanOutcome.notCheckedIn,
        message: 'This ticket was never checked in, so it cannot be checked out.',
        attendeeName: 'Sabina Tamang',
        ticketCode: 'TKT-7414',
        qrToken: 'evl_6ab02k_dharan_spring',
        scanType: 'gate_out',
        gateName: 'Main Gate',
        scannedAt: _at,
      );
}
