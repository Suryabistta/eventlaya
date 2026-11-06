import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/stored_pass.dart';

/// Passes saved on this device (shared_preferences), so they open offline at
/// the gate. Kept on sign out: they belong to the phone, not the account.
class PassStore {
  PassStore._();
  static const _key = 'attendee_passes_v1';

  static Future<List<StoredPass>> load() async {
    try {
      final p = await SharedPreferences.getInstance();
      final raw = p.getString(_key);
      if (raw == null || raw.isEmpty) return [];
      final list = jsonDecode(raw);
      if (list is! List) return [];
      return [for (final j in list) if (j is Map) StoredPass.fromJson(Map<String, dynamic>.from(j))];
    } catch (e) {
      debugPrint('PassStore.load: $e');
      return [];
    }
  }

  static Future<void> _save(List<StoredPass> passes) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_key, jsonEncode([for (final x in passes) x.toJson()]));
  }

  /// Adds or replaces (same ticket) a pass. Returns the updated list.
  static Future<List<StoredPass>> upsert(StoredPass pass) => upsertAll([pass]);

  /// Adds or replaces several passes at once (e.g. every pass of an order).
  /// Passes are keyed by ticket, so an event can have any number of them.
  static Future<List<StoredPass>> upsertAll(List<StoredPass> passes) async {
    final all = await load();
    final keys = {for (final p in passes) p.key};
    all.removeWhere((x) => keys.contains(x.key));
    all.addAll(passes);
    await _save(all);
    return all;
  }

  /// Replaces the account's tickets with [remote] (from `GET /api/me/tickets/`).
  /// Passes registered on this device stay (updated from the server when the
  /// same ticket comes back). Returns the updated list.
  static Future<List<StoredPass>> replaceAccountPasses(List<StoredPass> remote) async {
    final all = await load();
    final device = {for (final p in all) if (p.source == 'device') p.key: p};
    final merged = <StoredPass>[
      for (final p in all)
        if (p.source == 'device' && !remote.any((r) => r.key == p.key)) p,
      for (final r in remote) device.containsKey(r.key) ? r.withSource('device') : r,
    ];
    await _save(merged);
    return merged;
  }

  /// Drops the account's tickets (on sign out); device passes stay.
  static Future<List<StoredPass>> removeAccountPasses() async {
    final all = (await load()).where((p) => p.source != 'account').toList();
    await _save(all);
    return all;
  }

  static Future<List<StoredPass>> remove(String key) async {
    final all = await load();
    all.removeWhere((x) => x.key == key);
    await _save(all);
    return all;
  }
}
