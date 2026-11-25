import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../screens/login_screen.dart';
import '../../ui/ui.dart';
import '../attendee_shell.dart';
import '../widgets/attendee_widgets.dart' show brandGradient;

/// Signed-out first launch: three short intro pages, then the attendee app. Shown once per install.
class IntroGate extends StatefulWidget {
  const IntroGate({super.key});

  static const _key = 'attendee_intro_seen';

  @override
  State<IntroGate> createState() => _IntroGateState();
}

class _IntroGateState extends State<IntroGate> {
  bool? _seen;

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance()
        .then((p) => p.getBool(IntroGate._key) ?? false)
        .catchError((_) => true) // storage trouble: don't block the app
        .then((v) {
      if (mounted) setState(() => _seen = v);
    });
  }

  Future<void> _finish({required bool signIn}) async {
    try {
      final p = await SharedPreferences.getInstance();
      await p.setBool(IntroGate._key, true);
    } catch (_) {}
    if (!mounted) return;
    setState(() => _seen = true);
    if (signIn) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen()));
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 350),
      child: switch (_seen) {
        null => const ColoredBox(key: ValueKey('blank'), color: AppColors.background, child: SizedBox.expand()),
        true => const AttendeeShell(key: ValueKey('shell')),
        false => IntroScreen(key: const ValueKey('intro'), onDone: _finish),
      },
    );
  }
}

class IntroScreen extends StatefulWidget {
  final Future<void> Function({required bool signIn}) onDone;
  const IntroScreen({super.key, required this.onDone});

  @override
  State<IntroScreen> createState() => _IntroScreenState();
}

class _IntroScreenState extends State<IntroScreen> {
  final _ctrl = PageController();
  int _page = 0;

  static const _pages = [
    (Icons.travel_explore_rounded, 'Find your next event', 'Concerts, festivals, conferences and more. Search, filter by day and save the ones you like.'),
    (Icons.qr_code_2_rounded, 'Your ticket, always with you', 'Book in a few taps. Your pass is saved on this phone and works at the gate even without internet.'),
    (Icons.how_to_vote_rounded, 'Vote, review and plan', 'Vote in contests, review events you went to, and find vendors and venues for your own.'),
  ];

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final last = _page == _pages.length - 1;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        body: DecoratedBox(
          decoration: const BoxDecoration(gradient: brandGradient),
          child: SafeArea(
            child: Column(children: [
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => widget.onDone(signIn: false),
                  child: Text('Skip', style: AppType.body(15, weight: FontWeight.w600, color: Colors.white)),
                ),
              ),
              Expanded(
                child: PageView.builder(
                  controller: _ctrl,
                  itemCount: _pages.length,
                  onPageChanged: (i) {
                    HapticFeedback.selectionClick();
                    setState(() => _page = i);
                  },
                  itemBuilder: (_, i) {
                    final (icon, title, body) = _pages[i];
                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 32),
                      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                        Container(
                          width: 150,
                          height: 150,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: Colors.white.withValues(alpha: 0.14),
                            border: Border.all(color: Colors.white.withValues(alpha: 0.3), width: 1.5),
                          ),
                          child: Icon(icon, size: 72, color: Colors.white),
                        ),
                        const SizedBox(height: 40),
                        Text(title,
                            textAlign: TextAlign.center,
                            style: AppType.heading(28, weight: FontWeight.w800, color: Colors.white)),
                        const SizedBox(height: 12),
                        Text(body,
                            textAlign: TextAlign.center,
                            style: AppType.body(15.5, color: Colors.white.withValues(alpha: 0.85), height: 1.5)),
                      ]),
                    );
                  },
                ),
              ),
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                for (var i = 0; i < _pages.length; i++)
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 250),
                    margin: const EdgeInsets.symmetric(horizontal: 3),
                    width: i == _page ? 24 : 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: i == _page ? 1 : 0.4),
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
              ]),
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 28, 24, 12),
                child: PrimaryButton(
                  label: last ? 'Start exploring' : 'Next',
                  tone: ButtonTone.onDark,
                  onPressed: last
                      ? () => widget.onDone(signIn: false)
                      : () => _ctrl.nextPage(duration: const Duration(milliseconds: 400), curve: Curves.easeOutCubic),
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: TextButton(
                  onPressed: () => widget.onDone(signIn: true),
                  child: Text('I have an account · Sign in',
                      style: AppType.body(14.5, weight: FontWeight.w600, color: Colors.white)),
                ),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}
