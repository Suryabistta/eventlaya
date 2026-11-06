import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../core/api_client.dart';
import '../../providers/event_provider.dart';
import '../../ui/ui.dart';
import 'new_task_screen.dart';

/// Task API base path (the events router is mounted under /api/events/).
const tasksPath = '/api/events/tasks/';

const taskCategories = {
  'stage': 'Stage and sound',
  'gate': 'Gate and security',
  'hospitality': 'Guest hospitality',
  'tech': 'Tech and registration',
  'catering': 'Food and drinks',
  'marketing': 'Media and photos',
};

const taskPriorities = {'low': 'Low', 'medium': 'Medium', 'high': 'High', 'urgent': 'Urgent'};

Tone priorityTone(String p) => switch (p) {
      'urgent' => Tone.danger,
      'high' => Tone.warning,
      'medium' => Tone.brand,
      _ => Tone.neutral,
    };

class EventTasksScreen extends ConsumerStatefulWidget {
  const EventTasksScreen({super.key});

  @override
  ConsumerState<EventTasksScreen> createState() => _EventTasksScreenState();
}

class _EventTasksScreenState extends ConsumerState<EventTasksScreen> {
  final _api = ApiClient();
  List<Map<String, dynamic>> _tasks = [];
  bool _loading = true;
  String? _error;
  String _filter = 'all';

  @override
  void initState() {
    super.initState();
    _fetchTasks();
    ref.listenManual(eventProvider.select((s) => s.currentEvent?.id), (prev, next) {
      if (prev != next) _fetchTasks();
    });
  }

  Future<void> _fetchTasks() async {
    final event = ref.read(eventProvider).currentEvent;
    if (event == null) {
      setState(() => _loading = false);
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await _api.get(tasksPath, queryParameters: {'event_id': event.id});
      final data = res.data;
      final list = data is List
          ? data
          : (data is Map && data['results'] is List)
              ? data['results'] as List
              : <dynamic>[];
      if (!mounted) return;
      setState(() => _tasks = list.map((t) => Map<String, dynamic>.from(t as Map)).toList());
    } on DioException catch (e) {
      if (mounted) setState(() => _error = _api.errorMessage(e));
    } catch (e) {
      if (mounted) setState(() => _error = 'Something went wrong: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _updateTaskStatus(String taskId, String newStatus) async {
    final idx = _tasks.indexWhere((t) => t['id'].toString() == taskId);
    if (idx == -1) return;
    final previous = _tasks[idx]['status'];
    setState(() => _tasks[idx]['status'] = newStatus); // optimistic
    try {
      await _api.patch('$tasksPath$taskId/', data: {'status': newStatus});
      if (mounted) {
        AppToast.success(
          context,
          switch (newStatus) {
            'completed' => 'Task marked as done',
            'in_progress' => 'Task moved to in progress',
            _ => 'Task moved to to do',
          },
        );
      }
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() => _tasks[idx]['status'] = previous);
      AppToast.error(context, "Couldn't update the task. ${_api.errorMessage(e)}");
    }
  }

  Future<void> _deleteTask(String taskId) async {
    final ok = await confirmSheet(
      context,
      title: 'Delete this task?',
      message: 'It will be removed for everyone on the crew.',
      confirmLabel: 'Delete task',
    );
    if (!ok) return;
    try {
      await _api.delete('$tasksPath$taskId/');
      if (!mounted) return;
      setState(() => _tasks.removeWhere((t) => t['id'].toString() == taskId));
      AppToast.success(context, 'Task deleted');
    } on DioException catch (e) {
      if (mounted) AppToast.error(context, "Couldn't delete the task. ${_api.errorMessage(e)}");
    }
  }

  Future<void> _addTask() async {
    final event = ref.read(eventProvider).currentEvent;
    if (event == null) {
      AppToast.error(context, 'Pick an event first');
      return;
    }
    final created = await Navigator.of(context, rootNavigator: true).push<Map<String, dynamic>>(
      MaterialPageRoute(fullscreenDialog: true, builder: (_) => NewTaskScreen(event: event)),
    );
    if (created != null && mounted) {
      setState(() => _tasks.insert(0, created));
      AppToast.success(context, 'Task added');
    }
  }

  void _openTask(Map<String, dynamic> task) {
    final id = task['id'].toString();
    final status = task['status']?.toString() ?? 'todo';
    showAppSheet<void>(
      context,
      builder: (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          SheetHeader(
            title: task['title']?.toString() ?? 'Task',
            message: (task['description']?.toString().isNotEmpty ?? false) ? task['description'].toString() : null,
          ),
          for (final s in const [
            ('todo', 'To do', Icons.radio_button_unchecked_rounded),
            ('in_progress', 'In progress', Icons.timelapse_rounded),
            ('completed', 'Done', Icons.check_circle_outline_rounded),
          ])
            SheetAction(
              icon: s.$3,
              label: s.$2,
              selected: status == s.$1,
              onTap: () {
                Navigator.pop(ctx);
                if (status != s.$1) _updateTaskStatus(id, s.$1);
              },
            ),
          const Divider(height: 16),
          SheetAction(
            icon: Icons.delete_outline_rounded,
            label: 'Delete task',
            destructive: true,
            onTap: () {
              Navigator.pop(ctx);
              _deleteTask(id);
            },
          ),
        ],
      ),
    );
  }

  int _count(String s) => _tasks.where((t) => t['status'] == s).length;

  @override
  Widget build(BuildContext context) {
    final event = ref.watch(eventProvider).currentEvent;
    final filtered = _tasks.where((t) => _filter == 'all' || t['status'] == _filter).toList();

    return AppScaffold(
      title: 'Tasks',
      onRefresh: event == null ? null : _fetchTasks,
      actions: [
        if (event != null) AppIconButton(icon: Icons.add_rounded, tooltip: 'Add task', onPressed: _addTask),
      ],
      slivers: [
        if (event == null)
          const SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.event_outlined,
              title: 'No event selected',
              message: 'Pick an event on the Home tab to plan its tasks.',
            ),
          )
        else if (_error != null && _tasks.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: ErrorState(title: "Couldn't load tasks", message: _error!, onRetry: _fetchTasks),
          )
        else if (_loading && _tasks.isEmpty)
          const SliverToBoxAdapter(child: LoadingList(rows: 4, avatar: false))
        else if (_tasks.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.task_alt_rounded,
              title: 'No tasks yet',
              message: 'Add tasks to split the work across your crew — stage, gates, food and more.',
              actionLabel: 'Add a task',
              actionIcon: Icons.add_rounded,
              onAction: _addTask,
            ),
          )
        else ...[
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: FilterPills<String>(
                selected: _filter,
                onChanged: (v) => setState(() => _filter = v),
                segments: [
                  Segment('all', 'All', count: _tasks.length),
                  Segment('todo', 'To do', count: _count('todo')),
                  Segment('in_progress', 'In progress', count: _count('in_progress')),
                  Segment('completed', 'Done', count: _count('completed')),
                ],
              ),
            ),
          ),
          if (filtered.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: EmptyState(
                icon: Icons.filter_list_rounded,
                title: 'Nothing here',
                message: 'No tasks with this status.',
                actionLabel: 'Show all tasks',
                onAction: () => setState(() => _filter = 'all'),
              ),
            )
          else
            SliverToBoxAdapter(
              child: LayoutBuilder(builder: (context, c) {
                final cards = [
                  for (final t in filtered)
                    _TaskCard(
                      task: t,
                      onTap: () => _openTask(t),
                      onToggleDone: () => _updateTaskStatus(
                        t['id'].toString(),
                        t['status'] == 'completed' ? 'todo' : 'completed',
                      ),
                    ),
                ];
                if (c.maxWidth < 640) {
                  return Column(children: [
                    for (final card in cards) Padding(padding: const EdgeInsets.only(bottom: 12), child: card),
                  ]);
                }
                // Two columns on tablets.
                final left = <Widget>[], right = <Widget>[];
                for (var i = 0; i < cards.length; i++) {
                  (i.isEven ? left : right).add(Padding(padding: const EdgeInsets.only(bottom: 12), child: cards[i]));
                }
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: Column(children: left)),
                    const SizedBox(width: 12),
                    Expanded(child: Column(children: right)),
                  ],
                );
              }),
            ),
        ],
      ],
    );
  }
}

class _TaskCard extends StatelessWidget {
  final Map<String, dynamic> task;
  final VoidCallback onTap;
  final VoidCallback onToggleDone;

  const _TaskCard({required this.task, required this.onTap, required this.onToggleDone});

  @override
  Widget build(BuildContext context) {
    final status = task['status']?.toString() ?? 'todo';
    final priority = task['priority']?.toString() ?? 'medium';
    final category = task['category']?.toString() ?? 'tech';
    final title = task['title']?.toString() ?? 'Task';
    final desc = task['description']?.toString() ?? '';
    final assignedName = task['assigned_name']?.toString() ?? '';
    final done = status == 'completed';

    return GroupedSurface(
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(4, 8, 14, 14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Semantics(
                label: done ? 'Mark as not done' : 'Mark as done',
                button: true,
                child: InkResponse(
                  onTap: onToggleDone,
                  radius: 22,
                  child: SizedBox(
                    width: AppSpace.tap,
                    height: AppSpace.tap,
                    child: Icon(
                      done
                          ? Icons.check_circle_rounded
                          : status == 'in_progress'
                              ? Icons.timelapse_rounded
                              : Icons.radio_button_unchecked_rounded,
                      color: done
                          ? AppColors.success
                          : status == 'in_progress'
                              ? AppColors.brand
                              : AppColors.ink300,
                      size: 26,
                    ),
                  ),
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: AppType.body(16, weight: FontWeight.w600).copyWith(
                          color: done ? AppColors.ink400 : AppColors.textPrimary,
                          decoration: done ? TextDecoration.lineThrough : null,
                          decorationColor: AppColors.ink400,
                        ),
                      ),
                      if (desc.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(desc, maxLines: 3, overflow: TextOverflow.ellipsis, style: AppType.rowSubtitle),
                      ],
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          StatusBadge(taskPriorities[priority] ?? priority, tone: priorityTone(priority)),
                          StatusBadge(taskCategories[category] ?? category, dot: false),
                          if (assignedName.isNotEmpty)
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.person_outline_rounded, size: 16, color: AppColors.ink400),
                                const SizedBox(width: 3),
                                Text(assignedName, style: AppType.caption),
                              ],
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
