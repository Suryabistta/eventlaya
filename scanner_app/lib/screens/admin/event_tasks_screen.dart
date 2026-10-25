import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';
import '../../core/theme.dart';
import '../../providers/event_provider.dart';

class EventTasksScreen extends ConsumerStatefulWidget {
  const EventTasksScreen({super.key});

  @override
  ConsumerState<EventTasksScreen> createState() => _EventTasksScreenState();
}

class _EventTasksScreenState extends ConsumerState<EventTasksScreen> {
  List<Map<String, dynamic>> _tasks = [];
  bool _loading = true;
  String _filter = 'all';

  @override
  void initState() {
    super.initState();
    _fetchTasks();
  }

  Future<void> _fetchTasks() async {
    final event = ref.read(eventProvider).currentEvent;
    if (event == null) return;

    setState(() => _loading = true);
    try {
      final res = await ApiClient().get(
        '/events/tasks/',
        queryParameters: {'event_id': event.id},
      );
      if (res.data is List) {
        setState(() {
          _tasks = List<Map<String, dynamic>>.from(res.data);
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _loading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to load crew tasks: $e')),
        );
      }
    }
  }

  Future<void> _updateTaskStatus(String taskId, String newStatus) async {
    try {
      await ApiClient().patch(
        '/events/tasks/$taskId/',
        data: {'status': newStatus},
      );
      setState(() {
        final idx = _tasks.indexWhere((t) => t['id'] == taskId);
        if (idx != -1) {
          _tasks[idx]['status'] = newStatus;
        }
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update task: $e')),
        );
      }
    }
  }

  Future<void> _deleteTask(String taskId) async {
    try {
      await ApiClient().delete('/events/tasks/$taskId/');
      setState(() {
        _tasks.removeWhere((t) => t['id'] == taskId);
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to delete task: $e')),
        );
      }
    }
  }

  void _showAddTaskSheet() {
    final event = ref.read(eventProvider).currentEvent;
    if (event == null) return;

    final titleCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    final assigneeCtrl = TextEditingController();
    String category = 'tech';
    String priority = 'medium';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
            left: 20,
            right: 20,
            top: 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Assign Operations Task',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 20),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: titleCtrl,
                decoration: InputDecoration(
                  labelText: 'Task Title *',
                  hintText: 'e.g., Gate 2 QR Scanner Battery Backup',
                  filled: true,
                  fillColor: AppColors.cardBg,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      value: category,
                      decoration: InputDecoration(
                        labelText: 'Department',
                        filled: true,
                        fillColor: AppColors.cardBg,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      dropdownColor: AppColors.cardBg,
                      items: const [
                        DropdownMenuItem(value: 'stage', child: Text('Stage & Sound')),
                        DropdownMenuItem(value: 'gate', child: Text('Gate & Security')),
                        DropdownMenuItem(value: 'hospitality', child: Text('VIP Hospitality')),
                        DropdownMenuItem(value: 'tech', child: Text('Technical & Web')),
                        DropdownMenuItem(value: 'catering', child: Text('Food & Catering')),
                        DropdownMenuItem(value: 'marketing', child: Text('Media & Photo')),
                      ],
                      onChanged: (val) => setModalState(() => category = val!),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      value: priority,
                      decoration: InputDecoration(
                        labelText: 'Priority',
                        filled: true,
                        fillColor: AppColors.cardBg,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      dropdownColor: AppColors.cardBg,
                      items: const [
                        DropdownMenuItem(value: 'low', child: Text('Low')),
                        DropdownMenuItem(value: 'medium', child: Text('Medium')),
                        DropdownMenuItem(value: 'high', child: Text('High')),
                        DropdownMenuItem(value: 'urgent', child: Text('Urgent')),
                      ],
                      onChanged: (val) => setModalState(() => priority = val!),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: assigneeCtrl,
                decoration: InputDecoration(
                  labelText: 'Assignee Name / Role',
                  hintText: 'e.g. Ramesh Adhikari (Gate Lead)',
                  filled: true,
                  fillColor: AppColors.cardBg,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: descCtrl,
                maxLines: 2,
                decoration: InputDecoration(
                  labelText: 'Instructions & Notes',
                  hintText: 'Details, deliverables, or checklist items...',
                  filled: true,
                  fillColor: AppColors.cardBg,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () async {
                  if (titleCtrl.text.trim().isEmpty) return;
                  Navigator.pop(ctx);
                  try {
                    final res = await ApiClient().post('/events/tasks/', data: {
                      'event': event.id,
                      'title': titleCtrl.text.trim(),
                      'description': descCtrl.text.trim(),
                      'category': category,
                      'priority': priority,
                      'assigned_name': assigneeCtrl.text.trim(),
                    });
                    if (res.data is Map) {
                      setState(() {
                        _tasks.insert(0, Map<String, dynamic>.from(res.data));
                      });
                    }
                  } catch (e) {
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('Failed to assign task: $e')),
                      );
                    }
                  }
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                child: const Text('Assign Operations Duty', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _tasks.where((t) {
      if (_filter == 'all') return true;
      return t['status'] == _filter;
    }).toList();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Work Distribution & Crew Tasks'),
        backgroundColor: AppColors.surface,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _fetchTasks,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showAddTaskSheet,
        backgroundColor: AppColors.primary,
        icon: const Icon(Icons.add, color: Colors.white),
        label: const Text('Assign Task', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
      ),
      body: Column(
        children: [
          // Filter Tabs Bar
          Container(
            color: AppColors.surface,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _FilterChip(
                    label: 'All (${_tasks.length})',
                    selected: _filter == 'all',
                    onTap: () => setState(() => _filter = 'all'),
                  ),
                  const SizedBox(width: 8),
                  _FilterChip(
                    label: 'To Do (${_tasks.where((t) => t['status'] == 'todo').length})',
                    selected: _filter == 'todo',
                    onTap: () => setState(() => _filter = 'todo'),
                  ),
                  const SizedBox(width: 8),
                  _FilterChip(
                    label: 'In Progress (${_tasks.where((t) => t['status'] == 'in_progress').length})',
                    selected: _filter == 'in_progress',
                    onTap: () => setState(() => _filter = 'in_progress'),
                  ),
                  const SizedBox(width: 8),
                  _FilterChip(
                    label: 'Completed (${_tasks.where((t) => t['status'] == 'completed').length})',
                    selected: _filter == 'completed',
                    onTap: () => setState(() => _filter = 'completed'),
                  ),
                ],
              ),
            ),
          ),

          // Tasks List
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : filtered.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.task_alt_outlined, size: 56, color: AppColors.textSecondary),
                            const SizedBox(height: 12),
                            Text(
                              'No ${_filter == "all" ? "" : _filter.replaceAll("_", " ")} tasks found',
                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 14),
                            ),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _fetchTasks,
                        child: ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: filtered.length,
                          itemBuilder: (ctx, idx) {
                            final task = filtered[idx];
                            return _TaskItemCard(
                              task: task,
                              onStatusChange: (newStatus) => _updateTaskStatus(task['id'], newStatus),
                              onDelete: () => _deleteTask(task['id']),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _FilterChip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : AppColors.cardBg,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: selected ? AppColors.primary : AppColors.divider),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? Colors.white : AppColors.textSecondary,
            fontSize: 12,
            fontWeight: selected ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ),
    );
  }
}

class _TaskItemCard extends StatelessWidget {
  final Map<String, dynamic> task;
  final Function(String) onStatusChange;
  final VoidCallback onDelete;

  const _TaskItemCard({
    required this.task,
    required this.onStatusChange,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final status = task['status'] ?? 'todo';
    final priority = task['priority'] ?? 'medium';
    final category = task['category'] ?? 'tech';
    final title = task['title'] ?? 'Operations Task';
    final desc = task['description'] ?? '';
    final assignedName = task['assigned_name'] ?? '';

    Color priorityColor = Colors.grey;
    if (priority == 'urgent') priorityColor = Colors.redAccent;
    if (priority == 'high') priorityColor = Colors.orangeAccent;
    if (priority == 'medium') priorityColor = Colors.blueAccent;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.cardBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: status == 'completed' ? AppColors.success.withOpacity(0.3) : AppColors.divider,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  category.toString().toUpperCase(),
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 10, fontWeight: FontWeight.bold),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: priorityColor.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: priorityColor.withOpacity(0.4)),
                ),
                child: Text(
                  priority.toString().toUpperCase(),
                  style: TextStyle(color: priorityColor, fontSize: 10, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            title,
            style: TextStyle(
              color: status == 'completed' ? AppColors.textSecondary : AppColors.textPrimary,
              fontWeight: FontWeight.w700,
              fontSize: 14,
              decoration: status == 'completed' ? TextDecoration.lineThrough : null,
            ),
          ),
          if (desc.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(desc, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          ],
          if (assignedName.isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.person_outline, size: 14, color: AppColors.secondary),
                const SizedBox(width: 4),
                Text(
                  assignedName,
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          const Divider(height: 1),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  if (status != 'todo')
                    TextButton(
                      onPressed: () => onStatusChange('todo'),
                      child: const Text('To Do', style: TextStyle(fontSize: 11)),
                    ),
                  if (status != 'in_progress')
                    TextButton(
                      onPressed: () => onStatusChange('in_progress'),
                      child: const Text('In Progress', style: TextStyle(fontSize: 11, color: Colors.blueAccent)),
                    ),
                  if (status != 'completed')
                    TextButton(
                      onPressed: () => onStatusChange('completed'),
                      child: const Text('Complete', style: TextStyle(fontSize: 11, color: AppColors.success)),
                    ),
                ],
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 18, color: Colors.redAccent),
                onPressed: onDelete,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
