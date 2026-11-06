import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../core/api_client.dart';
import '../../providers/event_provider.dart';
import '../../ui/ui.dart';

/// Sends a push message to every gate staff device for the current event.
Future<void> showBroadcastSheet(BuildContext context) async {
  final event = ProviderScope.containerOf(context, listen: false).read(eventProvider).currentEvent;
  if (event == null) {
    AppToast.error(context, 'Pick an event first');
    return;
  }

  final titleCtrl = TextEditingController(text: 'Gate update: ${event.title}');
  final msgCtrl = TextEditingController();
  final api = ApiClient();
  var sending = false;

  await showAppSheet<void>(
    context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          const SheetHeader(
            title: 'Message gate staff',
            message: 'Sends a notification to every staff phone scanning this event.',
          ),
          TextField(
            controller: titleCtrl,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Title'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: msgCtrl,
            autofocus: true,
            maxLines: 4,
            minLines: 3,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: 'Message',
              hintText: 'e.g. Send VIP guests to the north entrance.',
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 20),
          PrimaryButton(
            label: 'Send to staff',
            icon: Icons.send_rounded,
            loading: sending,
            onPressed: () async {
              final text = msgCtrl.text.trim();
              if (text.isEmpty) {
                AppToast.error(ctx, 'Write a message first');
                return;
              }
              setState(() => sending = true);
              try {
                await api.post('/api/events/${event.id}/broadcast/', data: {
                  'title': titleCtrl.text.trim(),
                  'message': text,
                });
                if (ctx.mounted) {
                  AppToast.success(ctx, 'Message sent to gate staff');
                  Navigator.pop(ctx);
                }
              } on DioException catch (e) {
                if (ctx.mounted) {
                  setState(() => sending = false);
                  AppToast.error(ctx, "Couldn't send the message. ${api.errorMessage(e)}");
                }
              }
            },
          ),
        ],
      ),
    ),
  );
}
