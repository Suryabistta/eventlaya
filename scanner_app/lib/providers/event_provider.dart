import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../core/api_client.dart';
import '../core/storage.dart';
import '../models/event_model.dart';
import '../models/gate_stats_model.dart';

class EventState {
  final EventModel? currentEvent;
  final String? selectedGate;
  final GateStatsModel stats;
  final bool isLoading;
  final String? error;

  const EventState({
    this.currentEvent,
    this.selectedGate,
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
    GateStatsModel? stats,
    bool? isLoading,
    String? error,
  }) =>
      EventState(
        currentEvent: currentEvent ?? this.currentEvent,
        selectedGate: selectedGate ?? this.selectedGate,
        stats: stats ?? this.stats,
        isLoading: isLoading ?? this.isLoading,
        error: error,
      );
}

class EventNotifier extends StateNotifier<EventState> {
  EventNotifier() : super(const EventState());

  final _api = ApiClient();
  Timer? _pollTimer;

  Future<void> loadFromStorage() async {
    final gate = await AppStorage.getSelectedGate();
    if (gate != null) {
      state = state.copyWith(selectedGate: gate);
    }
  }

  void setGate(String gate) async {
    state = state.copyWith(selectedGate: gate);
    await AppStorage.saveSelectedGate(gate);
  }

  Future<void> loadAssignment() async {
    try {
      final resp = await _api.get('/api/events/my-assignment/');
      final data = resp.data as Map<String, dynamic>;
      final event = EventModel.fromJson(data['event'] as Map<String, dynamic>);
      final gate = data['gate_name']?.toString() ?? 'Main Gate';
      state = state.copyWith(currentEvent: event, selectedGate: gate);
      await AppStorage.saveSelectedGate(gate);
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

  Future<List<EventModel>> fetchAllEvents() async {
    try {
      final resp = await _api.get('/api/events/');
      final data = resp.data;
      final List list = (data is List)
          ? data
          : (data is Map && data['results'] is List)
              ? data['results'] as List
              : [];
      return list.map((e) => EventModel.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return [];
    }
  }

  void setCurrentEvent(EventModel event) async {
    state = state.copyWith(currentEvent: event);
    await AppStorage.saveSelectedEventId(event.id);
    startPolling();
  }

  void startPolling() {
    _pollTimer?.cancel();
    final eventId = state.currentEvent?.id;
    if (eventId == null || eventId.isEmpty) return;
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) => fetchStats(eventId));
    fetchStats(eventId);
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
