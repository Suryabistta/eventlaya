import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../ui/ui.dart';

/// Shows a one-time temporary password for a staff account, with a copy
/// button. Used after creating a team member, resetting a password, or when
/// assigning someone to a gate creates their account.
Future<void> showStaffCredentialsSheet(
  BuildContext context, {
  required String email,
  required String password,
  String? name,
  String title = 'Share sign-in details',
}) {
  final who = (name != null && name.trim().isNotEmpty) ? name.trim() : email;
  return showAppSheet<void>(
    context,
    builder: (ctx) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        SheetHeader(
          title: title,
          message: 'Give these to $who. They sign in to this app with them to scan at the gate.',
        ),
        GroupedSurface(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Email', style: AppType.caption),
              const SizedBox(height: 2),
              SelectableText(email, style: AppType.mono(15)),
              const SizedBox(height: 14),
              const Divider(height: 0.5, thickness: 0.5, color: AppColors.separator),
              const SizedBox(height: 14),
              Text('Temporary password', style: AppType.caption),
              const SizedBox(height: 2),
              SelectableText(password, style: AppType.mono(20, weight: FontWeight.w600)),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.marigoldTint,
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.info_outline_rounded, size: 20, color: AppColors.marigoldDark),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  "This password is shown only once. Copy it now — if it's lost, reset it from Team.",
                  style: AppType.body(13, color: AppColors.marigoldDark, height: 1.4),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        PrimaryButton(
          label: 'Copy details',
          icon: Icons.copy_rounded,
          onPressed: () async {
            await Clipboard.setData(ClipboardData(text: 'Email: $email\nPassword: $password'));
            if (ctx.mounted) AppToast.success(ctx, 'Sign-in details copied');
          },
        ),
        const SizedBox(height: 8),
        PrimaryButton(
          label: 'Done',
          tone: ButtonTone.neutral,
          tonal: true,
          onPressed: () => Navigator.pop(ctx),
        ),
      ],
    ),
  );
}
