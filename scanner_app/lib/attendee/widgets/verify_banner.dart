import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../ui/ui.dart';
import '../providers/pass_providers.dart';
import '../screens/verify_email_screen.dart';

/// "Verify your email to see passes from other devices" (signed in, unverified).
class VerifyEmailBanner extends ConsumerWidget {
  final String message;
  const VerifyEmailBanner({super.key, this.message = 'Verify your email to see passes from other devices.'});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(needsEmailVerificationProvider)) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Material(
        color: AppColors.marigoldTint,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const VerifyEmailScreen())),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(children: [
              const Icon(Icons.mark_email_unread_outlined, color: AppColors.marigoldDark),
              const SizedBox(width: 10),
              Expanded(child: Text(message, style: AppType.body(13.5, weight: FontWeight.w500, color: AppColors.ink800))),
              Text('Verify', style: AppType.body(14, weight: FontWeight.w600, color: AppColors.brand)),
            ]),
          ),
        ),
      ),
    );
  }
}
