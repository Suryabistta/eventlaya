import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/app_user.dart';
import '../providers/auth_provider.dart';
import '../providers/event_provider.dart';
import 'admin/admin_home_screen.dart';
import 'staff/gate_select_screen.dart';
import 'login_screen.dart';

class RoleRouter extends ConsumerStatefulWidget {
  const RoleRouter({super.key});

  @override
  ConsumerState<RoleRouter> createState() => _RoleRouterState();
}

class _RoleRouterState extends ConsumerState<RoleRouter> {
  @override
  void initState() {
    super.initState();
    _initRoleData();
  }

  Future<void> _initRoleData() async {
    final eventNotifier = ref.read(eventProvider.notifier);
    await eventNotifier.loadFromStorage();
    await eventNotifier.loadAssignment();

    final user = ref.read(authProvider).user;
    if (user?.isStaff == true) {
      final eventState = ref.read(eventProvider);
      if (eventState.currentEvent != null) {
        ref.read(eventProvider.notifier).startPolling();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final user = authState.user;

    if (user == null) {
      return const LoginScreen();
    }

    switch (user.role) {
      case UserRole.superadmin:
      case UserRole.organizer:
        return const AdminHomeScreen();
      case UserRole.staff:
        return const GateSelectScreen();
      default:
        return Scaffold(
          backgroundColor: const Color(0xFF0F0E1A),
          body: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.block_rounded, color: Color(0xFFEF4444), size: 56),
                  const SizedBox(height: 16),
                  const Text(
                    'Access Restricted',
                    style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Your account role (${user.role.name}) does not have permission to access the gate scanner.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 14),
                  ),
                  const SizedBox(height: 28),
                  ElevatedButton(
                    onPressed: () async {
                      await ref.read(authProvider.notifier).logout();
                      if (context.mounted) {
                        Navigator.of(context).pushReplacement(
                          MaterialPageRoute(builder: (_) => const LoginScreen()),
                        );
                      }
                    },
                    child: const Text('Sign Out'),
                  ),
                ],
              ),
            ),
          ),
        );
    }
  }
}
