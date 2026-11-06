import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import '../../core/api_client.dart';
import '../../models/event_model.dart';
import '../../ui/ui.dart';
import 'event_tasks_screen.dart';

/// Full-page form to add a crew task. Pops with the created task.
class NewTaskScreen extends StatefulWidget {
  final EventModel event;
  const NewTaskScreen({super.key, required this.event});

  @override
  State<NewTaskScreen> createState() => _NewTaskScreenState();
}

class _NewTaskScreenState extends State<NewTaskScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _assigneeCtrl = TextEditingController();
  String _category = 'tech';
  String _priority = 'medium';
  bool _saving = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _assigneeCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final res = await _api.post(tasksPath, data: {
        'event': widget.event.id,
        'title': _titleCtrl.text.trim(),
        'description': _descCtrl.text.trim(),
        'category': _category,
        'priority': _priority,
        'assigned_name': _assigneeCtrl.text.trim(),
      });
      if (!mounted) return;
      if (res.data is Map) {
        Navigator.pop(context, Map<String, dynamic>.from(res.data as Map));
      } else {
        Navigator.pop(context);
        AppToast.success(context, 'Task added');
      }
    } on DioException catch (e) {
      if (mounted) AppToast.error(context, "Couldn't add the task. ${_api.errorMessage(e)}");
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pick(String title, Map<String, String> options, String current, ValueChanged<String> onPick) async {
    final v = await showAppSheet<String>(
      context,
      builder: (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          SheetHeader(title: title),
          for (final e in options.entries)
            SheetAction(
              icon: Icons.label_outline_rounded,
              label: e.value,
              selected: e.key == current,
              onTap: () => Navigator.pop(ctx, e.key),
            ),
        ],
      ),
    );
    if (v != null) setState(() => onPick(v));
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _formKey,
      child: AppScaffold(
        title: 'New task',
        leading: Padding(
          padding: const EdgeInsets.only(left: 4),
          child: NavTextButton(label: 'Cancel', onPressed: () => Navigator.pop(context)),
        ),
        bottomBar: PrimaryButton(label: 'Add task', loading: _saving, onPressed: _save),
        slivers: [
          SliverToBoxAdapter(
            child: GroupedSection(
              header: 'For ${widget.event.title}',
              children: [
                FieldRow(
                  controller: _titleCtrl,
                  label: 'Title',
                  hint: 'e.g. Charge backup batteries for gate 2',
                  textCapitalization: TextCapitalization.sentences,
                  autofocus: true,
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Give the task a title' : null,
                ),
                FieldRow(
                  controller: _descCtrl,
                  label: 'Notes',
                  hint: 'Details, checklist, where to find things',
                  textCapitalization: TextCapitalization.sentences,
                  maxLines: 4,
                ),
              ],
            ),
          ),
          SliverToBoxAdapter(
            child: GroupedSection(
              children: [
                ListRow(
                  title: 'Team',
                  value: taskCategories[_category],
                  chevron: true,
                  onTap: () => _pick('Team', taskCategories, _category, (v) => _category = v),
                ),
                ListRow(
                  title: 'Priority',
                  trailing: StatusBadge(taskPriorities[_priority]!, tone: priorityTone(_priority)),
                  chevron: true,
                  onTap: () => _pick('Priority', taskPriorities, _priority, (v) => _priority = v),
                ),
              ],
            ),
          ),
          SliverToBoxAdapter(
            child: GroupedSection(
              footer: 'Write a name or role, e.g. "Ramesh (gate lead)".',
              children: [
                FieldRow(
                  controller: _assigneeCtrl,
                  label: 'Assigned to',
                  icon: Icons.person_outline_rounded,
                  textCapitalization: TextCapitalization.words,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
