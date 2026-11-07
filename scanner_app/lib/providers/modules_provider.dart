import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api_client.dart';
import 'auth_provider.dart';

/// Platform module slugs the apps care about (see backend apps/accounts/modules.py).
class AppModule {
  AppModule._();
  static const events = 'events';
  static const gateScanner = 'gate_scanner';
  static const voting = 'voting';
  static const marketplace = 'marketplace';
  static const reviews = 'reviews';
  static const chat = 'chat';

  /// Contests / pageants (needs [voting]).
  static const contests = 'contests';

  /// Judges' scoring (web only; listed for the superadmin switch).
  static const judging = 'judging';

  /// Selling vote packs (needs [contests] and [payments]).
  static const paidVotes = 'paid_votes';

  /// Khalti / eSewa online payments.
  static const payments = 'payments';

  /// Vendor & venue packages (needs [marketplace]).
  static const packages = 'packages';

  /// Modules that only work when these others are on too.
  static const requires = <String, List<String>>{
    contests: [voting],
    judging: [voting, contests],
    paidVotes: [voting, contests, payments],
  };
}

/// Which modules are switched on for the signed-in user.
///
/// `null` [enabled] means "unknown" (signed out, or the list couldn't be
/// loaded): everything is shown and the server's 403 `module_disabled`
/// answer is handled where it happens.
class ModuleAccess {
  final Set<String>? enabled;

  /// The server sends each module's `requires` and leaves out modules that are effectively off
  /// (2026-10 and later), so a missing slug means "off". Older servers didn't know the voting
  /// sub-modules; there they count as on (the API still answers 403 `module_disabled` if not).
  final bool strict;
  const ModuleAccess(this.enabled, {this.strict = true});

  static const unknown = ModuleAccess(null);

  static const _subModules = {'contests', 'judging', 'paid_votes'};

  bool isEnabled(String slug) {
    final on = enabled;
    if (on == null || on.contains(slug)) return true;
    return !strict && _subModules.contains(slug);
  }

  /// From `GET /api/auth/modules/`.
  factory ModuleAccess.fromJson(Object? data) {
    final list = data is Map ? data['modules'] : null;
    if (list is! List) return unknown;
    final isSuper = data is Map && data['is_superadmin'] == true;
    final maps = [for (final m in list) if (m is Map) m];
    return ModuleAccess(
      {
        for (final m in maps)
          if (isSuper || m['is_globally_enabled'] != false) m['slug'].toString(),
      },
      strict: maps.any((m) => m.containsKey('requires')),
    );
  }
}

/// `GET /api/auth/modules/` for the signed-in user; re-fetched on sign in/out.
final modulesProvider = FutureProvider<ModuleAccess>((ref) async {
  final userId = ref.watch(authProvider.select((s) => s.user?.id));
  if (userId == null) return ModuleAccess.unknown;
  try {
    final resp = await ApiClient().get('/api/auth/modules/');
    return ModuleAccess.fromJson(resp.data);
  } catch (e) {
    debugPrint('modulesProvider: $e');
    return ModuleAccess.unknown;
  }
});

/// Modules the server reported as switched off during this session (403
/// `module_disabled`), so the UI can hide them even for signed-out users.
final disabledModulesProvider = StateProvider<Set<String>>((ref) {
  ref.watch(authProvider.select((s) => s.user?.id)); // reset on sign in / out
  return const {};
});

/// Whether [slug] should be shown. Modules that depend on others ([AppModule.requires]) are
/// shown only when those are on too (e.g. contests need voting; paid votes need contests and payments).
final moduleEnabledProvider = Provider.family<bool, String>((ref, slug) {
  final disabled = ref.watch(disabledModulesProvider);
  final access = ref.watch(modulesProvider).valueOrNull ?? ModuleAccess.unknown;
  return moduleOn(slug, access, disabled);
});

/// [slug] and everything it needs are switched on.
bool moduleOn(String slug, ModuleAccess access, Set<String> disabled) {
  for (final s in [slug, ...?AppModule.requires[slug]]) {
    if (disabled.contains(s) || !access.isEnabled(s)) return false;
  }
  return true;
}

/// Call from a catch block: records a module_disabled answer so the feature
/// hides itself. Returns true when [error] was a module_disabled response.
bool noteModuleDisabled(WidgetRef ref, Object error) {
  final slug = ApiClient.disabledModule(error);
  if (slug == null) return ApiClient.isModuleDisabled(error);
  final current = ref.read(disabledModulesProvider);
  if (!current.contains(slug)) {
    ref.read(disabledModulesProvider.notifier).state = {...current, slug};
  }
  return true;
}
