import 'dart:async';
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../core/api_client.dart';
import '../core/storage.dart';
import '../models/event_model.dart';
import '../models/gate_model.dart';
import '../models/gate_stats_model.dart';
import '../models/ticket_type_model.dart';

class EventState {
  final EventModel? currentEvent;

  /// Display name of the gate scans are recorded against.
  final String? selectedGate;

  /// The chosen per-event gate, when the server provides gates (null for
  /// legacy name-only gates).
  final GateModel? gate;

  /// True when the organizer assigned this gate to the staff member.
  final bool gateLocked;
  final GateStatsModel stats;
  final bool isLoading;
  final String? error;

  const EventState({
    this.currentEvent,
    this.selectedGate,
    this.gate,
    this.gateLocked = false,
    this.stats = const GateStatsModel(
      totalRegistered: 0,
      checkedIn: 0,
      checkedOut: 0,
      capacity: 0,
      recentScans: [],
    ),
    this.isLoading = false,
    this.error,
  });

  EventState copyWith({
    EventModel? currentEvent,
    String? selectedGate,
    GateModel? gate,
    bool clearGate = false,
    bool? gateLocked,
    GateStatsModel? stats,
    bool? isLoading,
    String? error,
  }) =>
      EventState(
        currentEvent: currentEvent ?? this.currentEvent,
        selectedGate: selectedGate ?? this.selectedGate,
        gate: clearGate ? null : (gate ?? this.gate),
        gateLocked: gateLocked ?? this.gateLocked,
        stats: stats ?? this.stats,
        isLoading: isLoading ?? this.isLoading,
        error: error,
      );
}

class EventNotifier extends StateNotifier<EventState> {
  EventNotifier([super.initial = const EventState()]);

  final _api = ApiClient();
  Timer? _pollTimer;

  Future<void> loadFromStorage() async {
    final gate = await AppStorage.getSelectedGate();
    if (gate != null) {
      state = state.copyWith(selectedGate: gate);
    }
    final gateJson = await AppStorage.getSelectedGateJson();
    if (gateJson != null) {
      try {
        state = state.copyWith(gate: GateModel.fromJson(jsonDecode(gateJson) as Map<String, dynamic>));
      } catch (_) {}
    }
  }

  /// Sets a free-text gate name (legacy servers without per-event gates).
  void setGate(String gate) async {
    state = state.copyWith(selectedGate: gate, clearGate: true);
    await AppStorage.saveSelectedGate(gate);
    await AppStorage.saveSelectedGateJson(null);
  }

  /// Selects one of the event's configured gates.
  Future<void> selectGate(GateModel gate) async {
    if (gate.id.isEmpty) return setGate(gate.name);
    state = state.copyWith(selectedGate: gate.name, gate: gate);
    await AppStorage.saveSelectedGate(gate.name);
    await AppStorage.saveSelectedGateJson(jsonEncode(gate.toJson()));
  }

  /// Loads the event's active gates, ordered. Returns null when the server
  /// does not support per-event gates yet (404), so the app falls back to
  /// free-text gate names. Throws a readable message on other failures.
  Future<List<GateModel>?> fetchGates(String eventId) async {
    try {
      final resp = await _api.get('/api/events/$eventId/gates/');
      final data = resp.data;
      final List list = (data is List)
          ? data
          : (data is Map && data['results'] is List)
              ? data['results'] as List
              : [];
      final gates = list
          .map((g) => GateModel.fromJson(Map<String, dynamic>.from(g as Map)))
          .where((g) => g.isActive)
          .toList()
        ..sort((a, b) => a.order.compareTo(b.order));
      return gates;
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return null;
      throw _api.errorMessage(e);
    }
  }

  Future<void> loadAssignment() async {
    try {
      final resp = await _api.get('/api/events/my-assignment/');
      final data = resp.data as Map<String, dynamic>;
      final event = EventModel.fromJson(data['event'] as Map<String, dynamic>);
      final gateObj = data['gate'] is Map ? GateModel.fromJson(Map<String, dynamic>.from(data['gate'] as Map)) : null;
      final gate = gateObj?.name ?? data['gate_name']?.toString();
      state = EventState(
        currentEvent: event,
        selectedGate: gate,
        stats: state.stats,
        gate: gateObj,
        gateLocked: gateObj != null,
      );
      if (gate != null) await AppStorage.saveSelectedGate(gate);
      await AppStorage.saveSelectedGateJson(gateObj == null ? null : jsonEncode(gateObj.toJson()));
      await AppStorage.saveSelectedEventId(event.id);
    } on DioException {
      // Not assigned or error: allow manual selection
    }
  }

  Future<void> fetchStats(String eventId) async {
    try {
      final resp = await _api.get('/api/events/$eventId/gate/stats/');
      final stats = GateStatsModel.fromJson(resp.data as Map<String, dynamic>);
      state = state.copyWith(stats: stats);
    } catch (_) {}
  }

  /// Per-ticket-type sales from the event analytics. Empty when the server has
  /// no ticket types or the user can't see analytics.
  Future<List<TicketTypeStat>> fetchTicketTypeStats(String eventId) async {
    try {
      final resp = await _api.get('/api/events/$eventId/analytics/');
      final data = resp.data;
      final list = data is Map && data['ticket_types'] is List ? data['ticket_types'] as List : const [];
      return list.whereType<Map>().map((e) => TicketTypeStat.fromJson(Map<String, dynamic>.from(e))).toList();
    } catch (_) {
      return const [];
    }
  }

  /// Loads all events. Throws a readable message on failure.
  Future<List<EventModel>> fetchEvents() async {
    try {
      final resp = await _api.get('/api/events/');
      final data = resp.data;
      final List list = (data is List)
          ? data
          : (data is Map && data['results'] is List)
              ? data['results'] as List
              : [];
      return list.map((e) => EventModel.fromJson(e as Map<String, dynamic>)).toList();
    } on DioException catch (e) {
      throw _api.errorMessage(e);
    }
  }

  /// Like [fetchEvents] but returns an empty list on failure.
  Future<List<EventModel>> fetchAllEvents() async {
    try {
      return await fetchEvents();
    } catch (_) {
      return [];
    }
  }

  void setCurrentEvent(EventModel event) async {
    final changed = state.currentEvent?.id != event.id;
    // Gates belong to an event: forget the previous event's gate.
    state = state.copyWith(currentEvent: event, clearGate: changed && !state.gateLocked);
    if (changed && !state.gateLocked) await AppStorage.saveSelectedGateJson(null);
    await AppStorage.saveSelectedEventId(event.id);
    startPolling();
  }

  /// Swaps in a freshly loaded copy of the current event (phase, dates…)
  /// without resetting the gate or polling.
  void refreshEvent(EventModel fresh) {
    if (state.currentEvent?.id != fresh.id) return;
    state = state.copyWith(currentEvent: fresh);
  }

  void startPolling() {
    _pollTimer?.cancel();
    final eventId = state.currentEvent?.id;
    if (eventId == null || eventId.isEmpty) return;
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) => fetchStats(eventId));
    fetchStats(eventId);
  }

  /// Clears the selected event and stops polling (used on sign-out).
  void reset() {
    stopPolling();
    state = const EventState();
  }

  void stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  @override
  void dispose() {
    stopPolling();
    super.dispose();
  }
}

final eventProvider = StateNotifierProvider<EventNotifier, EventState>((ref) {
  return EventNotifier();
});

/// All events the signed-in user can see. Refresh with `ref.invalidate(eventsProvider)`.
final eventsProvider = FutureProvider<List<EventModel>>((ref) {
  return ref.read(eventProvider.notifier).fetchEvents();
});

/// Active gates for an event (null = server has no per-event gates; use free text).
final gatesProvider = FutureProvider.family<List<GateModel>?, String>((ref, eventId) {
  return ref.read(eventProvider.notifier).fetchGates(eventId);
});

/// Ticket types with sold / checked-in counts. Refresh with `ref.invalidate(ticketTypeStatsProvider(id))`.
final ticketTypeStatsProvider = FutureProvider.family<List<TicketTypeStat>, String>((ref, eventId) {
  return ref.read(eventProvider.notifier).fetchTicketTypeStats(eventId);
});
