import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import '../../core/api_client.dart';
import '../../providers/modules_provider.dart';
import '../../ui/ui.dart';

/// Icon and colour for a platform module (backend apps/accounts/modules.py).
({IconData icon, Color color}) moduleLook(String slug) => switch (slug) {
      'events' => (icon: Icons.event_rounded, color: AppColors.brand),
      'gate_scanner' => (icon: Icons.qr_code_scanner_rounded, color: AppColors.ink700),
      'dynamic_forms' => (icon: Icons.dynamic_form_outlined, color: AppColors.ink500),
      'voting' => (icon: Icons.how_to_vote_rounded, color: AppColors.brand),
      'contests' => (icon: Icons.emoji_events_rounded, color: AppColors.marigold),
      'judging' => (icon: Icons.gavel_rounded, color: AppColors.ink600),
      'paid_votes' => (icon: Icons.add_card_rounded, color: AppColors.success),
      'payments' => (icon: Icons.credit_card_rounded, color: AppColors.success),
      'marketplace' => (icon: Icons.storefront_rounded, color: AppColors.marigoldDark),
      'staff_management' => (icon: Icons.badge_rounded, color: AppColors.ink600),
      'chat' => (icon: Icons.chat_bubble_rounded, color: AppColors.brandDark),
      'reviews' => (icon: Icons.star_rounded, color: AppColors.marigold),
      'white_label' => (icon: Icons.language_rounded, color: AppColors.ink700),
      'blog' => (icon: Icons.article_rounded, color: AppColors.ink500),
      _ => (icon: Icons.extension_rounded, color: AppColors.ink400),
    };

/// Superadmin: switch platform modules on or off for every organization.
class RbacModuleScreen extends StatefulWidget {
  const RbacModuleScreen({super.key});

  @override
  State<RbacModuleScreen> createState() => _RbacModuleScreenState();
}

class _RbacModuleScreenState extends State<RbacModuleScreen> {
  final _api = ApiClient();
  List<Map<String, dynamic>> _modules = [];
  bool _loading = true;
  String? _error;
  final Set<String> _saving = {};

  @override
  void initState() {
    super.initState();
    _fetchModules();
  }

  Future<void> _fetchModules() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get('/api/auth/rbac/');
      final list = (resp.data['modules'] as List? ?? []);
      if (mounted) setState(() => _modules = list.map((m) => Map<String, dynamic>.from(m as Map)).toList());
    } on DioException catch (e) {
      if (mounted) setState(() => _error = _api.errorMessage(e));
    } catch (e) {
      if (mounted) setState(() => _error = 'Something went wrong: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// "Needs Voting and Online payments" when a module this one depends on is off.
  String? _needs(String? slug) {
    final reqs = AppModule.requires[slug] ?? const <String>[];
    final off = [
      for (final r in reqs)
        if (_modules.any((m) => m['slug'] == r && m['is_globally_enabled'] != true))
          _modules.firstWhere((m) => m['slug'] == r)['name']?.toString() ?? r,
    ];
    return off.isEmpty ? null : 'Needs ${off.join(' and ')} (switched off)';
  }

  Future<void> _toggleModule(String slug, bool currentStatus) async {
    final nextStatus = !currentStatus;
    final idx = _modules.indexWhere((m) => m['slug'] == slug);
    if (idx == -1) return;
    final name = _modules[idx]['name']?.toString() ?? slug;
    setState(() {
      _modules[idx]['is_globally_enabled'] = nextStatus;
      _saving.add(slug);
    });

    try {
      await _api.post('/api/auth/rbac/toggle/', data: {
        'slug': slug,
        'is_enabled': nextStatus,
      });
      if (mounted) AppToast.success(context, '$name turned ${nextStatus ? 'on' : 'off'}');
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() => _modules[idx]['is_globally_enabled'] = currentStatus); // revert
      AppToast.error(context, "Couldn't change $name. ${_api.errorMessage(e)}");
    } finally {
      if (mounted) setState(() => _saving.remove(slug));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Modules',
      onRefresh: _fetchModules,
      slivers: [
        if (_error != null && _modules.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: ErrorState(title: "Couldn't load modules", message: _error!, onRetry: _fetchModules),
          )
        else if (_loading && _modules.isEmpty)
          const SliverToBoxAdapter(child: LoadingList(rows: 6, avatar: false))
        else if (_modules.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.tune_rounded,
              title: 'No modules',
              message: 'The server did not return any modules.',
              actionLabel: 'Refresh',
              onAction: _fetchModules,
            ),
          )
        else
          SliverToBoxAdapter(
            child: GroupedSection(
              footer: 'Turning a module off hides it for every organization on Eventlaya.',
              children: [
                for (final m in _modules)
                  ListRow(
                    leading: RowIcon(
                      moduleLook(m['slug']?.toString() ?? '').icon,
                      background: moduleLook(m['slug']?.toString() ?? '').color,
                    ),
                    title: m['name']?.toString() ?? '',
                    subtitleWidget: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                      if ((m['description']?.toString() ?? '').isNotEmpty)
                        Text(m['description'].toString(), maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.rowSubtitle),
                      if (_needs(m['slug']?.toString()) case final needs?)
                        Text(needs, style: AppType.body(12, weight: FontWeight.w500, color: AppColors.marigoldDark)),
                      Text(
                        m['slug']?.toString() ?? '',
                        style: AppType.mono(12, weight: FontWeight.w400, color: AppColors.ink400),
                      ),
                    ]),
                    trailing: Switch(
                      value: m['is_globally_enabled'] == true,
                      onChanged: _saving.contains(m['slug'])
                          ? null
                          : (_) => _toggleModule(m['slug']?.toString() ?? '', m['is_globally_enabled'] == true),
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
