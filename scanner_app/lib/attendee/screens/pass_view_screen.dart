import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import '../../providers/modules_provider.dart';
import '../../reviews/review_models.dart';
import '../../reviews/review_widgets.dart';
import '../../ui/ui.dart';
import '../models/stored_pass.dart';
import '../providers/pass_providers.dart';
import '../widgets/attendee_widgets.dart';
import 'event_detail_screen.dart';

/// Opens a saved pass on its own page.
Future<void> openPass(BuildContext context, StoredPass pass) => openPasses(context, [pass]);

/// Opens several passes (e.g. a whole order) to swipe through, starting at
/// [initial].
Future<void> openPasses(BuildContext context, List<StoredPass> passes, {int initial = 0}) {
  return Navigator.of(context).push(MaterialPageRoute(
    builder: (_) => PassViewScreen(passes: passes, initialIndex: initial),
  ));
}

/// "Guest 2 of order ORD-7K2M9Q" for a guest's pass; "Order ORD-…" for the
/// buyer's when [inGroup]; null otherwise.
String? passOrderLabel(StoredPass p, {bool inGroup = false}) {
  final ref = p.orderReference;
  if (p.isGuest) return ref == null ? p.guestLabel : '${p.guestLabel} of order $ref';
  if (inGroup && ref != null) return 'Order $ref';
  return null;
}

/// Shows the QR as large as possible on white, screen kept awake.
Future<void> openFullScreenQr(BuildContext context, StoredPass pass) {
  return Navigator.of(context, rootNavigator: true).push(PageRouteBuilder(
    opaque: true,
    transitionDuration: const Duration(milliseconds: 220),
    pageBuilder: (_, __, ___) => FullScreenQr(pass: pass),
    transitionsBuilder: (_, a, __, child) => FadeTransition(opacity: a, child: child),
  ));
}

/// One or more passes: the ticket(s) — swipe between them when there are
/// several — a full-screen QR button and housekeeping for the one showing.
class PassViewScreen extends ConsumerStatefulWidget {
  final List<StoredPass> passes;
  final int initialIndex;

  /// Shown after registering ("You're registered" / "Already registered").
  final String? banner;

  /// Second line under the banner (e.g. "Pay Rs 1,000 at the venue").
  final String? bannerDetail;

  PassViewScreen({
    super.key,
    StoredPass? pass,
    List<StoredPass>? passes,
    this.initialIndex = 0,
    this.banner,
    this.bannerDetail,
  })  : assert(pass != null || (passes != null && passes.isNotEmpty)),
        passes = passes ?? [pass!];

  @override
  ConsumerState<PassViewScreen> createState() => _PassViewScreenState();
}

class _PassViewScreenState extends ConsumerState<PassViewScreen> {
  late List<StoredPass> _passes = [...widget.passes];
  late int _index = widget.initialIndex.clamp(0, widget.passes.length - 1);
  final _scroll = ScrollController();
  double _pageWidth = 0;

  StoredPass get _pass => _passes[_index.clamp(0, _passes.length - 1)];
  bool get _many => _passes.length > 1;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_pageWidth <= 0) return;
    final i = (_scroll.offset / _pageWidth).round().clamp(0, _passes.length - 1);
    if (i != _index) setState(() => _index = i);
  }

  void _goTo(int i) {
    if (!_scroll.hasClients || _pageWidth <= 0) return;
    _scroll.animateTo(i * _pageWidth, duration: const Duration(milliseconds: 280), curve: Curves.easeOutCubic);
  }

  Future<void> _remove() async {
    final pass = _pass;
    final ok = await confirmSheet(
      context,
      title: 'Remove this pass?',
      message: _many
          ? 'Only this pass (${pass.attendeeName}) is removed from this phone. The ticket stays valid.'
          : "Your registration stays valid. You can get the pass again by registering with the same email.",
      confirmLabel: 'Remove',
    );
    if (!ok || !mounted) return;
    await ref.read(passesProvider.notifier).remove(pass);
    if (!mounted) return;
    AppToast.info(context, 'Pass removed from this phone');
    if (!_many) {
      Navigator.of(context).maybePop();
      return;
    }
    setState(() {
      _passes = [..._passes]..removeWhere((p) => p.key == pass.key);
      _index = _index.clamp(0, _passes.length - 1);
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(_index * _pageWidth);
    });
  }

  @override
  Widget build(BuildContext context) {
    final pass = _pass;
    final orderLabel = passOrderLabel(pass, inGroup: _many);
    return AppScaffold(
      title: _many ? 'Your passes' : 'Your pass',
      slivers: [
        SliverToBoxAdapter(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.banner != null) ...[
                Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 440),
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.successTint,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Row(children: [
                        const Icon(Icons.check_circle_rounded, color: AppColors.success),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(widget.banner!, style: AppType.body(14, weight: FontWeight.w500)),
                            if (widget.bannerDetail != null)
                              Text(widget.bannerDetail!, style: AppType.body(13, color: AppColors.ink600)),
                          ]),
                        ),
                      ]),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],
              if (_many) _pager() else _passCard(pass),
              if (_many) ...[
                const SizedBox(height: 4),
                _Dots(count: _passes.length, index: _index, onTap: _goTo),
              ],
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 440),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (orderLabel != null) ...[
                        const SizedBox(height: 10),
                        Text(orderLabel,
                            textAlign: TextAlign.center,
                            style: AppType.body(13, weight: FontWeight.w500, color: AppColors.ink500)),
                      ],
                      const SizedBox(height: 12),
                      Text(
                        _many
                            ? '${_passes.length == 2 ? 'Both' : 'All ${_passes.length}'} passes are saved on this phone and open without internet. '
                                'Swipe between them — each QR is scanned on its own at the gate.'
                            : 'Saved on this phone — it opens even without internet. Show the QR at the gate.',
                        textAlign: TextAlign.center,
                        style: AppType.caption,
                      ),
                      const SizedBox(height: 20),
                      PrimaryButton(
                        label: 'Show QR full screen',
                        icon: Icons.fullscreen_rounded,
                        onPressed: () => openFullScreenQr(context, pass),
                      ),
                      const SizedBox(height: 8),
                      PrimaryButton(
                        label: 'Event details',
                        icon: Icons.event_rounded,
                        tone: ButtonTone.neutral,
                        tonal: true,
                        onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => EventDetailScreen(slug: pass.eventSlug)),
                        ),
                      ),
                      if (pass.canReview && ref.watch(moduleEnabledProvider(AppModule.reviews))) ...[
                        const SizedBox(height: 8),
                        PrimaryButton(
                          label: 'Review this event',
                          icon: Icons.star_rounded,
                          tone: ButtonTone.warning,
                          tonal: true,
                          onPressed: () async {
                            final ok = await showWriteReviewSheet(
                                context, ref, ReviewTarget.event(pass.eventSlug, pass.eventTitle));
                            if (ok) {
                              await ref.read(passesProvider.notifier).refresh();
                              if (context.mounted) AppToast.success(context, 'Thanks for your review');
                            }
                          },
                        ),
                      ],
                      const SizedBox(height: 24),
                      GroupedSection(
                        children: [
                          ListRow(
                            title: 'Copy ticket code',
                            centered: true,
                            onTap: () {
                              Clipboard.setData(ClipboardData(text: pass.ticketNumber));
                              AppToast.success(context, 'Ticket code copied');
                            },
                          ),
                          ListRow(
                            title: _many ? 'Remove this pass from this phone' : 'Remove from this phone',
                            destructive: true,
                            centered: true,
                            onTap: _remove,
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
      ],
    );
  }

  Widget _passCard(StoredPass p) => Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: GestureDetector(
            onTap: () => openFullScreenQr(context, p),
            child: passWidget(p),
          ),
        ),
      );

  /// Passes side by side, one page per pass; as tall as the tallest pass.
  Widget _pager() {
    return LayoutBuilder(builder: (context, c) {
      final w = c.maxWidth;
      if (w != _pageWidth) {
        // First layout (lands on initialIndex) or a resize: stay on the same pass.
        _pageWidth = w;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && _scroll.hasClients) _scroll.jumpTo(_index * w);
        });
      }
      return SingleChildScrollView(
        controller: _scroll,
        scrollDirection: Axis.horizontal,
        physics: const PageScrollPhysics(parent: ClampingScrollPhysics()),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final p in _passes)
              SizedBox(
                width: w,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(6, 0, 6, 16),
                  child: _passCard(p),
                ),
              ),
          ],
        ),
      );
    });
  }
}

/// Page dots under a pass pager; tap to jump.
class _Dots extends StatelessWidget {
  final int count;
  final int index;
  final ValueChanged<int>? onTap;
  const _Dots({required this.count, required this.index, this.onTap});

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          for (var i = 0; i < count; i++)
            GestureDetector(
              onTap: onTap == null ? null : () => onTap!(i),
              behavior: HitTestBehavior.opaque,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 6),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  width: i == index ? 18 : 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: i == index ? AppColors.brand : AppColors.ink300,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              ),
            ),
        ],
      ),
      Text('Pass ${index + 1} of $count', style: AppType.caption),
    ]);
  }
}

/// White full-screen QR with the ticket code, kept awake.
/// (No screen-brightness package is bundled, so brightness isn't changed.)
class FullScreenQr extends StatefulWidget {
  final StoredPass pass;
  const FullScreenQr({super.key, required this.pass});

  @override
  State<FullScreenQr> createState() => _FullScreenQrState();
}

class _FullScreenQrState extends State<FullScreenQr> {
  @override
  void initState() {
    super.initState();
    WakelockPlus.enable().catchError((_) {});
  }

  @override
  void dispose() {
    WakelockPlus.disable().catchError((_) {});
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.pass;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => Navigator.of(context).maybePop(),
            child: LayoutBuilder(builder: (context, c) {
              final size = (c.biggest.shortestSide - 48).clamp(160.0, 520.0);
              return Stack(children: [
                Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Text(p.eventTitle,
                        textAlign: TextAlign.center, maxLines: 2, style: AppType.heading(20)),
                    const SizedBox(height: 4),
                    Text(p.attendeeName, style: AppType.body(15, color: AppColors.textSecondary)),
                    const SizedBox(height: 20),
                    QrImageView(
                      data: p.qrToken,
                      size: size,
                      padding: EdgeInsets.zero,
                      backgroundColor: Colors.white,
                      eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: Colors.black),
                      dataModuleStyle:
                          const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: Colors.black),
                      semanticsLabel: 'Ticket QR code',
                    ),
                    const SizedBox(height: 20),
                    Text(p.ticketNumber, style: AppType.mono(18, weight: FontWeight.w700)),
                    if (p.ticketTypeName.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(p.ticketTypeName, style: AppType.body(14, color: AppColors.textSecondary)),
                    ],
                    if (passOrderLabel(p) != null) ...[
                      const SizedBox(height: 2),
                      Text(passOrderLabel(p)!, style: AppType.body(13, color: AppColors.ink400)),
                    ],
                  ]),
                ),
                Positioned(
                  top: 4,
                  right: 4,
                  child: AppIconButton(
                    icon: Icons.close_rounded,
                    tooltip: 'Close',
                    color: AppColors.ink700,
                    onPressed: () => Navigator.of(context).maybePop(),
                  ),
                ),
              ]);
            }),
          ),
        ),
      ),
    );
  }
}
