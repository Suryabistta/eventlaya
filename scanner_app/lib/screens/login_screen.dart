import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/theme.dart';
import '../core/storage.dart';
import '../providers/auth_provider.dart';
import 'role_router.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController(text: 'organizer@eventlaya.com');
  final _passwordCtrl = TextEditingController(text: 'password123');
  final _serverUrlCtrl = TextEditingController();
  bool _obscurePassword = true;
  bool _showServerUrl = false;

  @override
  void initState() {
    super.initState();
    _loadServerUrl();
  }

  Future<void> _loadServerUrl() async {
    final url = await AppStorage.getServerUrl();
    _serverUrlCtrl.text = url;
  }

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    _serverUrlCtrl.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;

    if (_serverUrlCtrl.text.trim().isNotEmpty) {
      await AppStorage.saveServerUrl(_serverUrlCtrl.text.trim());
    }

    final success = await ref.read(authProvider.notifier).login(
      _emailCtrl.text.trim(),
      _passwordCtrl.text,
    );

    if (success && mounted) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const RoleRouter()),
      );
    }
  }

  void _fillCredentials(String email, String roleName) {
    setState(() {
      _emailCtrl.text = email;
      _passwordCtrl.text = 'password123';
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Filled $roleName demo credentials'),
        duration: const Duration(seconds: 1),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 30),
                Center(
                  child: Container(
                    width: 76,
                    height: 76,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [AppColors.primary, Color(0xFF7C3AED)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(22),
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.primary.withOpacity(0.35),
                          blurRadius: 18,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: const Icon(Icons.qr_code_scanner_rounded, size: 40, color: Colors.white),
                  ),
                ),
                const SizedBox(height: 18),
                Text(
                  'Eventlaya Scanner',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Organizer & Gate Staff Login',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 28),

                // Demo account selector chips
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      ActionChip(
                        avatar: const Icon(Icons.shield_outlined, size: 16, color: Colors.purpleAccent),
                        label: const Text('Superadmin'),
                        backgroundColor: AppColors.cardBg,
                        side: const BorderSide(color: AppColors.divider),
                        onPressed: () => _fillCredentials('superadmin@eventlaya.com', 'Superadmin'),
                      ),
                      const SizedBox(width: 8),
                      ActionChip(
                        avatar: const Icon(Icons.security, size: 16, color: AppColors.primary),
                        label: const Text('Organizer'),
                        backgroundColor: AppColors.cardBg,
                        side: const BorderSide(color: AppColors.divider),
                        onPressed: () => _fillCredentials('organizer@eventlaya.com', 'Organizer'),
                      ),
                      const SizedBox(width: 8),
                      ActionChip(
                        avatar: const Icon(Icons.badge, size: 16, color: AppColors.secondary),
                        label: const Text('Gate Staff'),
                        backgroundColor: AppColors.cardBg,
                        side: const BorderSide(color: AppColors.divider),
                        onPressed: () => _fillCredentials('staff@eventlaya.com', 'Staff'),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 20),

                // Email
                TextFormField(
                  controller: _emailCtrl,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  style: const TextStyle(color: AppColors.textPrimary),
                  decoration: const InputDecoration(
                    labelText: 'Email Address',
                    prefixIcon: Icon(Icons.email_outlined, color: AppColors.textSecondary),
                  ),
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) return 'Email is required';
                    if (!v.contains('@')) return 'Enter a valid email';
                    return null;
                  },
                ),
                const SizedBox(height: 14),

                // Password
                TextFormField(
                  controller: _passwordCtrl,
                  obscureText: _obscurePassword,
                  textInputAction: TextInputAction.done,
                  onFieldSubmitted: (_) => _login(),
                  style: const TextStyle(color: AppColors.textPrimary),
                  decoration: InputDecoration(
                    labelText: 'Password',
                    prefixIcon: const Icon(Icons.lock_outline, color: AppColors.textSecondary),
                    suffixIcon: IconButton(
                      icon: Icon(
                        _obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                        color: AppColors.textSecondary,
                      ),
                      onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                    ),
                  ),
                  validator: (v) {
                    if (v == null || v.isEmpty) return 'Password is required';
                    if (v.length < 4) return 'Password too short';
                    return null;
                  },
                ),

                // Server URL (collapsible)
                const SizedBox(height: 12),
                InkWell(
                  onTap: () => setState(() => _showServerUrl = !_showServerUrl),
                  borderRadius: BorderRadius.circular(8),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          _showServerUrl ? Icons.arrow_drop_up : Icons.arrow_drop_down,
                          color: AppColors.textSecondary,
                          size: 20,
                        ),
                        Text(
                          'Server Endpoint Settings',
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: AppColors.textSecondary,
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                if (_showServerUrl) ...[
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: _serverUrlCtrl,
                    keyboardType: TextInputType.url,
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
                    decoration: const InputDecoration(
                      labelText: 'Server Base URL',
                      hintText: 'http://127.0.0.1:8000',
                      prefixIcon: Icon(Icons.dns_outlined, color: AppColors.textSecondary),
                    ),
                  ),
                ],

                const SizedBox(height: 20),

                if (authState.error != null)
                  Container(
                    padding: const EdgeInsets.all(12),
                    margin: const EdgeInsets.only(bottom: 16),
                    decoration: BoxDecoration(
                      color: AppColors.error.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.error.withOpacity(0.3)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.error_outline, color: AppColors.error, size: 18),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            authState.error!,
                            style: const TextStyle(color: AppColors.error, fontSize: 13),
                          ),
                        ),
                      ],
                    ),
                  ),

                ElevatedButton(
                  onPressed: authState.isLoading ? null : _login,
                  child: authState.isLoading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Text('Sign In to Terminal'),
                ),

                const SizedBox(height: 28),
                Text(
                  'Eventlaya • Smart Ticketing & Access Control',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.textSecondary.withOpacity(0.6), fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
