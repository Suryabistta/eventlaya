import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../core/api_client.dart';
import '../core/connectivity_service.dart';
import '../core/offline_queue.dart';
import '../models/scan_result_model.dart';

class ScanState {
  final ScanResultModel? lastResult;
  final bool isScanning;
  final bool isProcessing;
  final bool isOnline;
  final int offlineQueueCount;

  /// Results scanned on this device in this session, newest first.
  final List<ScanResultModel> history;

  const ScanState({
    this.lastResult,
    this.isScanning = true,
    this.isProcessing = false,
    this.isOnline = true,
    this.offlineQueueCount = 0,
    this.history = const [],
  });

  ScanState copyWith({
    ScanResultModel? lastResult,
    bool? isScanning,
    bool? isProcessing,
    bool? isOnline,
    int? offlineQueueCount,
    List<ScanResultModel>? history,
  }) =>
      ScanState(
        lastResult: lastResult ?? this.lastResult,
        isScanning: isScanning ?? this.isScanning,
        isProcessing: isProcessing ?? this.isProcessing,
        isOnline: isOnline ?? this.isOnline,
        offlineQueueCount: offlineQueueCount ?? this.offlineQueueCount,
        history: history ?? this.history,
      );
}

/// Result of flushing the offline queue.
class FlushResult {
  final int synced;
  final int remaining;
  const FlushResult(this.synced, this.remaining);
}

class ScanNotifier extends StateNotifier<ScanState> {
  /// [listenConnectivity] can be turned off in tests where platform
  /// channels are not available.
  ScanNotifier({ScanState initial = const ScanState(), bool listenConnectivity = true})
      : super(initial) {
    if (listenConnectivity) {
      _connectivityService.init();
      _connectivitySub = _connectivityService.onlineStream.listen((online) {
        state = state.copyWith(isOnline: online);
        if (online && OfflineQueue.count > 0) {
          flushOfflineQueue();
        }
      });
      // Check initial queue count
      state = state.copyWith(offlineQueueCount: OfflineQueue.count);
    }
  }

  static const _historyLimit = 50;

  final _api = ApiClient();
  final _connectivityService = ConnectivityService();
  String? _lastScannedToken;
  DateTime? _lastScanTime;
  StreamSubscription? _connectivitySub;

  List<ScanResultModel> _withHistory(ScanResultModel r) {
    final list = [r, ...state.history];
    return list.length > _historyLimit ? list.sublist(0, _historyLimit) : list;
  }

  Future<ScanResultModel> scan({
    required String qrToken,
    required String scanType,
    required String gateName,
    String? gateId,
    required String eventId,
  }) async {
    // Debounce: ignore exact same token within 2 seconds
    final now = DateTime.now();
    if (_lastScannedToken == qrToken &&
        _lastScanTime != null &&
        now.difference(_lastScanTime!).inMilliseconds < 2000) {
      return ScanResultModel(
        outcome: ScanOutcome.alreadyIn,
        message: 'This pass was just scanned. Wait a moment before scanning it again.',
        ticketCode: qrToken,
        qrToken: qrToken,
        scanType: scanType,
        gateName: gateName,
        scannedAt: now,
      );
    }

    _lastScannedToken = qrToken;
    _lastScanTime = now;
    state = state.copyWith(isProcessing: true, isScanning: false);

    Future<ScanResultModel> queueOffline() async {
      await OfflineQueue.enqueue(OfflineScan(
        qrToken: qrToken,
        scanType: scanType,
        gateName: gateName,
        gateId: gateId,
        scannedAt: now.toIso8601String(),
        eventId: eventId,
      ));
      final result = ScanResultModel.networkError(qrToken: qrToken, scanType: scanType, gateName: gateName);
      state = state.copyWith(
        lastResult: result,
        isProcessing: false,
        offlineQueueCount: OfflineQueue.count,
        history: _withHistory(result),
      );
      return result;
    }

    if (!_connectivityService.isOnline) {
      // Offline mode: queue in local Hive database
      return queueOffline();
    }

    try {
      final resp = await _api.post('/api/events/$eventId/gate/scan/', data: {
        'qr_token': qrToken,
        'scan_type': scanType,
        'gate_name': gateName,
        if (gateId != null && gateId.isNotEmpty) 'gate_id': gateId,
        'scanned_at_client': now.toIso8601String(),
      });

      final result = ScanResultModel.fromJson(resp.data as Map<String, dynamic>, qrToken);
      state = state.copyWith(lastResult: result, isProcessing: false, history: _withHistory(result));
      return result;
    } on DioException catch (e) {
      // If network failure during request, fallback to queue
      if (e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout) {
        return queueOffline();
      }

      // The gate API answers invalid / cancelled / wrong-event passes with a
      // 4xx status but a normal scan body — read the outcome from it.
      final body = e.response?.data;
      final ScanResultModel result;
      if (body is Map && (body['status'] != null || body['result'] != null)) {
        result = ScanResultModel.fromJson(Map<String, dynamic>.from(body), qrToken);
      } else {
        result = ScanResultModel.serverError(_api.errorMessage(e),
            qrToken: qrToken, scanType: scanType, gateName: gateName);
      }
      state = state.copyWith(lastResult: result, isProcessing: false, history: _withHistory(result));
      return result;
    } catch (e) {
      final result = ScanResultModel.serverError('Something went wrong: $e',
          qrToken: qrToken, scanType: scanType, gateName: gateName);
      state = state.copyWith(lastResult: result, isProcessing: false, history: _withHistory(result));
      return result;
    }
  }

  Future<FlushResult> flushOfflineQueue() async {
    final scans = OfflineQueue.getAll();
    if (scans.isEmpty) return const FlushResult(0, 0);

    int successCount = 0;
    for (final scan in scans) {
      try {
        await _api.post('/api/events/${scan.eventId}/gate/scan/', data: scan.toJson());
        successCount++;
      } on DioException catch (e) {
        // A 4xx answer still means the server processed the scan (e.g. duplicate).
        final code = e.response?.statusCode ?? 0;
        if (code >= 400 && code < 500) {
          successCount++;
          continue;
        }
        break; // Stop flushing if connection broke
      } catch (_) {
        break;
      }
    }

    if (successCount > 0) {
      for (int i = successCount - 1; i >= 0; i--) {
        await OfflineQueue.removeAt(i);
      }
    }

    state = state.copyWith(offlineQueueCount: OfflineQueue.count);
    return FlushResult(successCount, OfflineQueue.count);
  }

  void resetScanner() {
    state = state.copyWith(isScanning: true, lastResult: null, isProcessing: false);
  }

  @override
  void dispose() {
    _connectivitySub?.cancel();
    super.dispose();
  }
}

final scanProvider = StateNotifierProvider<ScanNotifier, ScanState>((ref) {
  return ScanNotifier();
});
