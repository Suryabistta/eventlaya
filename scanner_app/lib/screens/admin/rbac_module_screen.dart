import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../core/theme.dart';

class RbacModuleScreen extends StatefulWidget {
  const RbacModuleScreen({super.key});

  @override
  State<RbacModuleScreen> createState() => _RbacModuleScreenState();
}

class _RbacModuleScreenState extends State<RbacModuleScreen> {
  final _api = ApiClient();
  List<Map<String, dynamic>> _modules = [];
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _fetchModules();
  }

  Future<void> _fetchModules() async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get('/api/auth/rbac/');
      final list = (resp.data['modules'] as List? ?? []);
      setState(() => _modules = list.map((m) => Map<String, dynamic>.from(m as Map)).toList());
    } catch (_) {
      // Fallback display
      setState(() {
        _modules = [
          {'name': 'Events Management', 'slug': 'events', 'is_globally_enabled': true},
          {'name': 'Gate QR Scanner Terminal', 'slug': 'gate_scanner', 'is_globally_enabled': true},
          {'name': 'Dynamic Registration Forms', 'slug': 'dynamic_forms', 'is_globally_enabled': true},
          {'name': 'Live Audience Voting & Polls', 'slug': 'voting', 'is_globally_enabled': true},
          {'name': 'Vendor Services Marketplace', 'slug': 'marketplace', 'is_globally_enabled': true},
          {'name': 'Gate Staff & Station Assignments', 'slug': 'staff_management', 'is_globally_enabled': true},
        ];
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleModule(String slug, bool currentStatus) async {
    final nextStatus = !currentStatus;
    setState(() {
      final idx = _modules.indexWhere((m) => m['slug'] == slug);
      if (idx != -1) _modules[idx]['is_globally_enabled'] = nextStatus;
    });

    try {
      await _api.post('/api/auth/rbac/toggle/', data: {
        'slug': slug,
        'is_enabled': nextStatus,
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Module $slug ${nextStatus ? "Enabled" : "Disabled"}'),
            duration: const Duration(seconds: 1),
          ),
        );
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Superadmin Module Control'),
        backgroundColor: AppColors.surface,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: _modules.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (_, i) {
                final m = _modules[i];
                final enabled = m['is_globally_enabled'] == true;
                final slug = m['slug']?.toString() ?? '';

                return Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppColors.cardBg,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: enabled ? AppColors.success.withOpacity(0.3) : AppColors.divider,
                      width: 0.8,
                    ),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: (enabled ? AppColors.success : AppColors.error).withOpacity(0.12),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(
                          enabled ? Icons.check_circle_outline : Icons.pause_circle_outline,
                          color: enabled ? AppColors.success : AppColors.error,
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              m['name']?.toString() ?? '',
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontWeight: FontWeight.w700,
                                fontSize: 14,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              slug,
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 11,
                                fontFamily: 'monospace',
                              ),
                            ),
                          ],
                        ),
                      ),
                      Switch(
                        value: enabled,
                        activeColor: AppColors.success,
                        onChanged: (_) => _toggleModule(slug, enabled),
                      ),
                    ],
                  ),
                );
              },
            ),
    );
  }
}
