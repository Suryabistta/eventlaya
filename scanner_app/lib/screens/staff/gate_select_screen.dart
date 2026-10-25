import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme.dart';
import '../../providers/auth_provider.dart';
import '../../providers/event_provider.dart';
import '../../models/event_model.dart';
import 'scanner_screen.dart';
import '../login_screen.dart';

class GateSelectScreen extends ConsumerStatefulWidget {
  const GateSelectScreen({super.key});

  @override
  ConsumerState<GateSelectScreen> createState() => _GateSelectScreenState();
}

class _GateSelectScreenState extends ConsumerState<GateSelectScreen> {
  final _gateCtrl = TextEditingController();
  EventModel? _selectedEvent;
  List<EventModel> _events = [];
  bool _loadingEvents = false;

  static const predefinedGates = [
    'Main Gate',
    'VIP Entrance',
    'North Gate',
    'South Gate',
    'Staff Entrance',
    'Emergency Exit',
  ];

  @override
  void initState() {
    super.initState();
    final eventState = ref.read(eventProvider);
    if (eventState.currentEvent != null) {
      _selectedEvent = eventState.currentEvent;
      _gateCtrl.text = eventState.selectedGate ?? 'Main Gate';
    } else {
      _loadEvents();
    }
  }

  Future<void> _loadEvents() async {
    setState(() => _loadingEvents = true);
    final events = await ref.read(eventProvider.notifier).fetchAllEvents();
    if (mounted) {
      setState(() {
        _events = events;
        _loadingEvents = false;
        if (events.isNotEmpty && _selectedEvent == null) {
          _selectedEvent = events.first;
        }
      });
      if (_gateCtrl.text.isEmpty) {
        _gateCtrl.text = 'Main Gate';
      }
    }
  }

  void _proceed() {
    final gate = _gateCtrl.text.trim();
    final event = _selectedEvent ?? ref.read(eventProvider).currentEvent;

    if (event == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select an event'), backgroundColor: AppColors.error),
      );
      return;
    }
    if (gate.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a gate name'), backgroundColor: AppColors.error),
      );
      return;
    }

    ref.read(eventProvider.notifier).setCurrentEvent(event);
    ref.read(eventProvider.notifier).setGate(gate);
    ref.read(eventProvider.notifier).startPolling();

    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const ScannerScreen()),
    );
  }

  @override
  void dispose() {
    _gateCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authProvider).user;
    final eventState = ref.watch(eventProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Gate Setup'),
        backgroundColor: AppColors.surface,
        actions: [
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
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Welcome staff card
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.cardBg,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.primary.withOpacity(0.3)),
              ),
              child: Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: AppColors.primary.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(Icons.badge_rounded, color: AppColors.primary, size: 26),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Gate Staff: ${user?.fullName ?? "Staff"}',
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontWeight: FontWeight.w700,
                            fontSize: 15,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          user?.email ?? '',
                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 24),

            // Assigned event card
            if (eventState.currentEvent != null) ...[
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.success.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.success.withOpacity(0.3)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.check_circle_outline, color: AppColors.success, size: 22),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Active Event Assignment',
                            style: TextStyle(
                              color: AppColors.success,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            eventState.currentEvent!.title,
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          Text(
                            eventState.currentEvent!.venue,
                            style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
            ] else ...[
              Text('Select Event', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 10),
              if (_loadingEvents)
                const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()))
              else if (_events.isEmpty)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.cardBg,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Text('No active events found. Contact your organizer.', style: TextStyle(color: AppColors.textSecondary)),
                )
              else
                DropdownButtonFormField<EventModel>(
                  value: _selectedEvent,
                  dropdownColor: AppColors.cardBg,
                  style: const TextStyle(color: AppColors.textPrimary),
                  decoration: const InputDecoration(
                    hintText: 'Choose an event',
                    prefixIcon: Icon(Icons.event_outlined, color: AppColors.textSecondary),
                  ),
                  items: _events.map((e) => DropdownMenuItem(
                    value: e,
                    child: Text(e.title, overflow: TextOverflow.ellipsis),
                  )).toList(),
                  onChanged: (e) => setState(() => _selectedEvent = e),
                ),
              const SizedBox(height: 24),
            ],

            // Gate name field
            Text('Gate / Station Name', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 10),
            TextFormField(
              controller: _gateCtrl,
              style: const TextStyle(color: AppColors.textPrimary),
              decoration: const InputDecoration(
                hintText: 'e.g. Main Gate, North Entrance',
                prefixIcon: Icon(Icons.meeting_room_outlined, color: AppColors.textSecondary),
              ),
            ),

            const SizedBox(height: 12),

            // Predefined gate chips
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: predefinedGates.map((gate) {
                final isSelected = _gateCtrl.text == gate;
                return GestureDetector(
                  onTap: () => setState(() => _gateCtrl.text = gate),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? AppColors.primary.withOpacity(0.25)
                          : AppColors.surface,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: isSelected ? AppColors.primary : AppColors.divider,
                      ),
                    ),
                    child: Text(
                      gate,
                      style: TextStyle(
                        color: isSelected ? AppColors.textPrimary : AppColors.textSecondary,
                        fontWeight: isSelected ? FontWeight.w700 : FontWeight.w400,
                        fontSize: 13,
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),

            const SizedBox(height: 36),

            ElevatedButton.icon(
              onPressed: _proceed,
              icon: const Icon(Icons.qr_code_scanner_rounded),
              label: const Text('Open Gate Scanner'),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
                backgroundColor: AppColors.primary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
