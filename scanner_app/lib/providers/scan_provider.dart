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

  const ScanState({
    this.lastResult,
    this.isScanning = true,
    this.isProcessing = false,
    this.isOnline = true,
    this.offlineQueueCount = 0,
  });

  ScanState copyWith({
    ScanResultModel? lastResult,
    bool? isScanning,
    bool? isProcessing,
    bool? isOnline,
    int? offlineQueueCount,
  }) =>
      ScanState(
        lastResult: lastResult ?? this.lastResult,
        isScanning: isScanning ?? this.isScanning,
        isProcessing: isProcessing ?? this.isProcessing,
        isOnline: isOnline ?? this.isOnline,
        offlineQueueCount: offlineQueueCount ?? this.offlineQueueCount,
      );
}

class ScanNotifier extends StateNotifier<ScanState> {
  ScanNotifier() : super(const ScanState()) {
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

  final _api = ApiClient();
  final _connectivityService = ConnectivityService();
  String? _lastScannedToken;
  DateTime? _lastScanTime;
  StreamSubscription? _connectivitySub;

  Future<ScanResultModel> scan({
    required String qrToken,
    required String scanType,
    required String gateName,
    required String eventId,
  }) async {
    // Debounce: ignore exact same token within 2 seconds
    final now = DateTime.now();
    if (_lastScannedToken == qrToken &&
        _lastScanTime != null &&
        now.difference(_lastScanTime!).inMilliseconds < 2000) {
      return ScanResultModel(
        outcome: ScanOutcome.alreadyIn,
        message: 'Duplicate scan ignored (Wait 2s).',
      );
    }

    _lastScannedToken = qrToken;
    _lastScanTime = now;
    state = state.copyWith(isProcessing: true, isScanning: false);

    if (!_connectivityService.isOnline) {
      // Offline mode: queue in local Hive database
      await OfflineQueue.enqueue(OfflineScan(
        qrToken: qrToken,
        scanType: scanType,
        gateName: gateName,
        scannedAt: now.toIso8601String(),
        eventId: eventId,
      ));
      final result = ScanResultModel.networkError();
      state = state.copyWith(
        lastResult: result,
        isProcessing: false,
        offlineQueueCount: OfflineQueue.count,
      );
      return result;
    }

    try {
      final resp = await _api.post('/api/events/$eventId/gate/scan/', data: {
        'qr_token': qrToken,
        'scan_type': scanType,
        'gate_name': gateName,
        'scanned_at_client': now.toIso8601String(),
      });

      final result = ScanResultModel.fromJson(resp.data as Map<String, dynamic>, qrToken);
      state = state.copyWith(lastResult: result, isProcessing: false);
      return result;
    } on DioException catch (e) {
      // If network failure during request, fallback to queue
      if (e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout) {
        await OfflineQueue.enqueue(OfflineScan(
          qrToken: qrToken,
          scanType: scanType,
          gateName: gateName,
          scannedAt: now.toIso8601String(),
          eventId: eventId,
        ));
        final result = ScanResultModel.networkError();
        state = state.copyWith(
          lastResult: result,
          isProcessing: false,
          offlineQueueCount: OfflineQueue.count,
        );
        return result;
      }

      final errMsg = _api.errorMessage(e);
      final result = ScanResultModel.serverError(errMsg);
      state = state.copyWith(lastResult: result, isProcessing: false);
      return result;
    } catch (e) {
      final result = ScanResultModel.serverError(e.toString());
      state = state.copyWith(lastResult: result, isProcessing: false);
      return result;
    }
  }

  Future<void> flushOfflineQueue() async {
    final scans = OfflineQueue.getAll();
    if (scans.isEmpty) return;

    int successCount = 0;
    for (final scan in scans) {
      try {
        await _api.post('/api/events/${scan.eventId}/gate/scan/', data: scan.toJson());
        successCount++;
      } catch (_) {
        break; // Stop flushing if connection broke
      }
    }

    if (successCount > 0) {
      for (int i = successCount - 1; i >= 0; i--) {
        await OfflineQueue.removeAt(i);
      }
    }

    state = state.copyWith(offlineQueueCount: OfflineQueue.count);
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
