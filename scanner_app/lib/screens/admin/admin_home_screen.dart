import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme.dart';
import '../../providers/auth_provider.dart';
import '../../providers/event_provider.dart';
import '../../models/event_model.dart';
import '../login_screen.dart';
import '../staff/scanner_screen.dart';
import 'attendees_screen.dart';
import 'scan_logs_screen.dart';
import 'staff_screen.dart';
import 'rbac_module_screen.dart';

class AdminHomeScreen extends ConsumerStatefulWidget {
  const AdminHomeScreen({super.key});

  @override
  ConsumerState<AdminHomeScreen> createState() => _AdminHomeScreenState();
}

class _AdminHomeScreenState extends ConsumerState<AdminHomeScreen> {
  int _tab = 0;
  List<EventModel> _events = [];
  bool _loadingEvents = true;

  @override
  void initState() {
    super.initState();
    _loadEvents();
  }

  Future<void> _loadEvents() async {
    final events = await ref.read(eventProvider.notifier).fetchAllEvents();
    if (mounted) {
      setState(() {
        _events = events;
        _loadingEvents = false;
      });
    }
    if (events.isNotEmpty && ref.read(eventProvider).currentEvent == null) {
      ref.read(eventProvider.notifier).setCurrentEvent(events.first);
    }
  }

  @override
  Widget build(BuildContext context) {
    final eventState = ref.watch(eventProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        title: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: [AppColors.primary, Color(0xFF7C3AED)]),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.qr_code_scanner_rounded, size: 18, color: Colors.white),
            ),
            const SizedBox(width: 10),
            const Text('Eventlaya'),
          ],
        ),
        actions: [
          // Event Switcher Dropdown
          if (eventState.currentEvent != null && _events.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: DropdownButton<EventModel>(
                value: _events.contains(eventState.currentEvent)
                    ? eventState.currentEvent
                    : _events.first,
                dropdownColor: AppColors.cardBg,
                underline: const SizedBox(),
                icon: const Icon(Icons.keyboard_arrow_down, color: AppColors.textSecondary),
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
                items: _events.map((e) => DropdownMenuItem(
                  value: e,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 130),
                    child: Text(e.title, overflow: TextOverflow.ellipsis),
                  ),
                )).toList(),
                onChanged: (e) {
                  if (e != null) ref.read(eventProvider.notifier).setCurrentEvent(e);
                },
              ),
            ),
          // Superadmin RBAC Module Switcher
          if (ref.watch(authProvider).user?.isSuperAdmin == true)
            IconButton(
              icon: const Icon(Icons.shield_outlined, color: Colors.purpleAccent),
              tooltip: 'Superadmin RBAC Modules',
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const RbacModuleScreen()),
                );
              },
            ),
          // Quick Switch to Scanner Terminal
          IconButton(
            icon: const Icon(Icons.camera_alt_outlined, color: AppColors.secondary),
            tooltip: 'Open Gate Scanner',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ScannerScreen()),
              );
            },
          ),
          IconButton(
            icon: const Icon(Icons.logout_outlined),
            onPressed: () async {
              await ref.read(authProvider.notifier).logout();
              if (context.mounted) {
                Navigator.of(context).pushReplacement(
                  MaterialPageRoute(builder: (_) => const LoginScreen()),
                );
              }
            },
          ),
        ],
      ),
      body: _loadingEvents
          ? const Center(child: CircularProgressIndicator())
          : _events.isEmpty
              ? _buildNoEvents()
              : IndexedStack(
                  index: _tab,
                  children: const [
                    _DashboardTab(),
                    AttendeesScreen(),
                    ScanLogsScreen(),
                    StaffScreen(),
                  ],
                ),
      bottomNavigationBar: NavigationBar(
        backgroundColor: AppColors.surface,
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.dashboard_outlined),
            selectedIcon: Icon(Icons.dashboard),
            label: 'Dashboard',
          ),
          NavigationDestination(
            icon: Icon(Icons.people_outline),
            selectedIcon: Icon(Icons.people),
            label: 'Attendees',
          ),
          NavigationDestination(
            icon: Icon(Icons.history_outlined),
            selectedIcon: Icon(Icons.history),
            label: 'Scan Logs',
          ),
          NavigationDestination(
            icon: Icon(Icons.badge_outlined),
            selectedIcon: Icon(Icons.badge),
            label: 'Crew',
          ),
        ],
      ),
    );
  }

  Widget _buildNoEvents() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.event_busy_outlined, size: 64, color: AppColors.textSecondary),
            const SizedBox(height: 16),
            const Text(
              'No Events Found',
              style: TextStyle(color: AppColors.textPrimary, fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            const Text(
              'Create events via web dashboard or run database seeder.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: _loadEvents,
              icon: const Icon(Icons.refresh),
              label: const Text('Refresh Events'),
            ),
          ],
        ),
      ),
    );
  }
}

class _DashboardTab extends ConsumerWidget {
  const _DashboardTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eventState = ref.watch(eventProvider);
    final stats = eventState.stats;
    final event = eventState.currentEvent;

    if (event == null) {
      return const Center(child: Text('Please select an event'));
    }

    final occupancy = event.capacity > 0
        ? (stats.checkedIn / event.capacity * 100).clamp(0, 100)
        : 0.0;

    return RefreshIndicator(
      onRefresh: () => ref.read(eventProvider.notifier).fetchStats(event.id),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Event Header Card
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppColors.primary, Color(0xFF7C3AED)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withOpacity(0.3),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    event.title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 18,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      const Icon(Icons.location_on_outlined, color: Colors.white70, size: 14),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          event.venue,
                          style: const TextStyle(color: Colors.white70, fontSize: 13),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (event.date != null)
                        Text(
                          event.date!,
                          style: const TextStyle(color: Colors.white70, fontSize: 12),
                        ),
                    ],
                  ),
                ],
              ),
            ),

            const SizedBox(height: 16),

            // Stat Cards Grid
            Row(
              children: [
                _StatCard(
                  label: 'Registered',
                  value: '${stats.totalRegistered}',
                  icon: Icons.how_to_reg_outlined,
                  color: AppColors.primary,
                ),
                const SizedBox(width: 10),
                _StatCard(
                  label: 'Checked In',
                  value: '${stats.checkedIn}',
                  icon: Icons.login_outlined,
                  color: AppColors.success,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                _StatCard(
                  label: 'Checked Out',
                  value: '${stats.checkedOut}',
                  icon: Icons.logout_outlined,
                  color: AppColors.warning,
                ),
                const SizedBox(width: 10),
                _StatCard(
                  label: 'Inside Now',
                  value: '${stats.currentlyInside}',
                  icon: Icons.people_outlined,
                  color: AppColors.secondary,
                ),
              ],
            ),

            const SizedBox(height: 16),

            // Live Capacity Meter
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.cardBg,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.divider, width: 0.5),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Venue Capacity Meter',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                        ),
                      ),
                      Text(
                        '${stats.checkedIn} / ${event.capacity > 0 ? event.capacity : "Unlimited"}',
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: LinearProgressIndicator(
                      value: stats.occupancyRate,
                      backgroundColor: AppColors.divider,
                      valueColor: AlwaysStoppedAnimation(
                        occupancy > 90
                            ? AppColors.error
                            : occupancy > 70
                                ? AppColors.warning
                                : AppColors.success,
                      ),
                      minHeight: 10,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '${occupancy.toStringAsFixed(1)}% occupancy',
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                      ),
                      Text(
                        event.capacity > 0 && (event.capacity - stats.checkedIn) > 0
                            ? '${event.capacity - stats.checkedIn} seats remaining'
                            : 'Full / At Limit',
                        style: TextStyle(
                          color: occupancy >= 100 ? AppColors.error : AppColors.textSecondary,
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            // Open Scanner Shortcut Button
            ElevatedButton.icon(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const ScannerScreen()),
                );
              },
              icon: const Icon(Icons.qr_code_scanner_rounded),
              label: const Text('Launch Gate Scanner Terminal'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),

            const SizedBox(height: 24),

            // Recent Scan Audit Stream
            if (stats.recentScans.isNotEmpty) ...[
              const Text(
                'Live Gate Activity',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                ),
              ),
              const SizedBox(height: 10),
              ...stats.recentScans.take(8).map((scan) {
                final isIn = scan.scanType == 'gate_in';
                final timePart = scan.scannedAt.length >= 16
                    ? scan.scannedAt.substring(11, 16)
                    : '';
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.cardBg,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.divider, width: 0.5),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          color: (isIn ? AppColors.success : AppColors.warning).withOpacity(0.14),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Icon(
                          isIn ? Icons.login_outlined : Icons.logout_outlined,
                          size: 16,
                          color: isIn ? AppColors.success : AppColors.warning,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              scan.attendeeName,
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            Text(
                              '${scan.gateName} • $timePart',
                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: (isIn ? AppColors.success : AppColors.warning).withOpacity(0.12),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          isIn ? 'IN' : 'OUT',
                          style: TextStyle(
                            color: isIn ? AppColors.success : AppColors.warning,
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              }),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color color;

  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.cardBg,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withOpacity(0.25)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: color, size: 22),
            const SizedBox(height: 10),
            Text(value, style: TextStyle(color: color, fontSize: 24, fontWeight: FontWeight.w800)),
            const SizedBox(height: 2),
            Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}
