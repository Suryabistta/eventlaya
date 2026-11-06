import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import '../../models/event_model.dart';
import '../../ui/ui.dart';
import '../attendee_shell.dart';
import '../models/stored_pass.dart';
import '../providers/pass_providers.dart';
import '../widgets/attendee_widgets.dart';
import 'pass_view_screen.dart';

/// Centre tab: the pass for the event happening now (or the next one), ready
/// to scan. Works offline from passes saved on this phone; keeps the screen
/// awake while open. Swipe between passes when there are several.
class MyPassScreen extends ConsumerStatefulWidget {
  final bool active;
  const MyPassScreen({super.key, required this.active});

  @override
  ConsumerState<MyPassScreen> createState() => _MyPassScreenState();
}

class _MyPassScreenState extends ConsumerState<MyPassScreen> {
  final _page = PageController();
  int _index = 0;

  @override
  void initState() {
    super.initState();
    _syncWakelock();
  }

  @override
  void didUpdateWidget(covariant MyPassScreen old) {
    super.didUpdateWidget(old);
    if (old.active != widget.active) _syncWakelock();
  }

  void _syncWakelock() {
    final hasPass = ref.read(nextPassProvider) != null;
    (widget.active && hasPass ? WakelockPlus.enable() : WakelockPlus.disable()).catchError((_) {});
  }

  @override
  void dispose() {
    if (widget.active) WakelockPlus.disable().catchError((_) {});
    _page.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final loading = ref.watch(passesProvider).isLoading;
    final passes = ref.watch(upcomingPassesProvider);
    ref.listen(nextPassProvider, (_, __) => _syncWakelock());
    final bottomPad = MediaQuery.paddingOf(context).bottom;
    final topPad = MediaQuery.paddingOf(context).top;
    final current = passes.isEmpty ? null : passes[_index.clamp(0, passes.length - 1)];

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Stack(
          children: [
            // Brand backdrop behind the top half of the pass.
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              height: topPad + 260,
              child: const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: brandGradient,
                  borderRadius: BorderRadius.vertical(bottom: Radius.circular(32)),
                ),
              ),
            ),
            Positioned.fill(
              child: Padding(
                padding: EdgeInsets.only(top: topPad + 12, bottom: bottomPad + 22),
                child: Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: Row(children: [
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('My Pass', style: AppType.heading(28, weight: FontWeight.w800, color: Colors.white)),
                            Text(
                              current == null
                                  ? 'Your next event, ready to scan'
                                  : current.phase == EventPhase.live
                                      ? 'Happening now — show this at the gate'
                                      : 'Next up · ${eventWhen(current.event)}',
                              style: AppType.body(13, color: Colors.white.withValues(alpha: 0.8)),
                            ),
                          ]),
                        ),
                        if (current != null)
                          AppIconButton(
                            icon: Icons.fullscreen_rounded,
                            tooltip: 'Full screen',
                            color: Colors.white,
                            background: Colors.white.withValues(alpha: 0.16),
                            onPressed: () => openFullScreenQr(context, current),
                          ),
                      ]),
                    ),
                    const SizedBox(height: 16),
                    Expanded(
                      child: passes.isEmpty
                          ? (loading
                              ? const Center(child: CircularProgressIndicator(color: Colors.white))
                              : const _NoPass())
                          : _PassPager(
                              passes: passes,
                              controller: _page,
                              onChanged: (i) => setState(() => _index = i),
                            ),
                    ),
                    if (passes.length > 1)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            for (var i = 0; i < passes.length; i++)
                              AnimatedContainer(
                                duration: const Duration(milliseconds: 180),
                                margin: const EdgeInsets.symmetric(horizontal: 3),
                                width: i == _index ? 18 : 6,
                                height: 6,
                                decoration: BoxDecoration(
                                  color: i == _index ? AppColors.brand : AppColors.ink300,
                                  borderRadius: BorderRadius.circular(3),
                                ),
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PassPager extends StatelessWidget {
  final List<StoredPass> passes;
  final PageController controller;
  final ValueChanged<int> onChanged;
  const _PassPager({required this.passes, required this.controller, required this.onChanged});

  /// Pass details for [i], swipeable with the other passes for that event.
  void _details(BuildContext context, int i) {
    final p = passes[i];
    final same = passes.where((x) => x.eventSlug == p.eventSlug).toList();
    openPasses(context, same, initial: same.indexOf(p));
  }

  @override
  Widget build(BuildContext context) {
    return PageView.builder(
      controller: controller,
      onPageChanged: onChanged,
      itemCount: passes.length,
      itemBuilder: (context, i) {
        final sameEvent = passes.where((x) => x.eventSlug == passes[i].eventSlug).length;
        final orderLabel = passOrderLabel(passes[i], inGroup: sameEvent > 1);
        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(children: [
                GestureDetector(
                  onTap: () => openFullScreenQr(context, passes[i]),
                  child: passWidget(passes[i]),
                ),
                if (orderLabel != null) ...[
                  const SizedBox(height: 10),
                  Text(orderLabel, style: AppType.body(13, weight: FontWeight.w500, color: AppColors.ink500)),
                ],
                const SizedBox(height: 6),
                TextButton.icon(
                  onPressed: () => _details(context, i),
                  icon: const Icon(Icons.info_outline_rounded, size: 18),
                  label: const Text('Pass details'),
                ),
              ]),
            ),
          ),
        );
      },
    );
  }
}

class _NoPass extends StatelessWidget {
  const _NoPass();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        child: GroupedSurface(
          child: EmptyState(
            icon: Icons.qr_code_2_rounded,
            title: 'No upcoming passes',
            message: 'Register for an event and your pass shows up here — it works offline at the gate.',
            actionLabel: 'Explore events',
            actionIcon: Icons.explore_rounded,
            onAction: () => AttendeeShell.goTo(context, AttendeeShell.exploreTab),
          ),
        ),
      ),
    );
  }
}
