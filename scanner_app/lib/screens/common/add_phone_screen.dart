import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../attendee/data/account_api.dart';
import '../../providers/auth_provider.dart';
import '../../ui/ui.dart';

/// Every account needs a mobile number. People who signed in with Google / Facebook (no phone from them) or older
/// accounts without one add it here once, then carry on.
class AddPhoneScreen extends ConsumerStatefulWidget {
  const AddPhoneScreen({super.key});

  @override
  ConsumerState<AddPhoneScreen> createState() => _AddPhoneScreenState();
}

class _AddPhoneScreenState extends ConsumerState<AddPhoneScreen> {
  final _phone = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final v = _phone.text.trim();
    final digits = v.replaceAll(RegExp(r'\D'), '').length;
    if (digits < 7 || digits > 15) {
      setState(() => _error = 'Enter a valid mobile number, like 98XXXXXXXX.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final user = await AccountApi().updateProfile({'phone': v});
      await ref.read(authProvider.notifier).setUser(user);
    } catch (e) {
      if (mounted) setState(() => _error = 'Couldn’t save. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Icon(Icons.phone_iphone_rounded, size: 44, color: AppColors.brand),
                const SizedBox(height: 16),
                const Text('Add your mobile number', textAlign: TextAlign.center, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                const Text('Every Eventlaya account needs one, so organizers and vendors can reach you. It isn’t shown publicly.',
                    textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary)),
                const SizedBox(height: 24),
                TextField(
                  controller: _phone,
                  autofocus: true,
                  keyboardType: TextInputType.phone,
                  autofillHints: const [AutofillHints.telephoneNumber],
                  decoration: InputDecoration(labelText: 'Mobile number', hintText: '98XXXXXXXX', errorText: _error),
                  onSubmitted: (_) => _save(),
                ),
                const SizedBox(height: 16),
                PrimaryButton(label: 'Save and continue', loading: _busy, onPressed: _save),
                const SizedBox(height: 8),
                TextButton(onPressed: () => ref.read(authProvider.notifier).logout(), child: const Text('Sign out')),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
