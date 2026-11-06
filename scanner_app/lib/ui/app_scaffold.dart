import 'dart:math' as math;
import 'dart:ui';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'tokens.dart';

/// Page with an iOS-style large title that collapses into a frosted nav bar.
///
/// Content is given as slivers; [AppScaffold.box] wraps a regular widget.
/// Horizontal gutters and a max content width are applied automatically.
class AppScaffold extends StatelessWidget {
  final String title;
  final List<Widget> slivers;
  final List<Widget> actions;
  final Widget? leading;
  final Future<void> Function()? onRefresh;

  /// Pinned at the bottom (e.g. a primary button), above the safe area.
  final Widget? bottomBar;

  /// Show a back button when the route can pop (default true).
  final bool automaticBack;
  final ScrollController? controller;

  /// Apply the horizontal gutter/max-width to [slivers] (default true).
  final bool padded;

  const AppScaffold({
    super.key,
    required this.title,
    required this.slivers,
    this.actions = const [],
    this.leading,
    this.onRefresh,
    this.bottomBar,
    this.automaticBack = true,
    this.controller,
    this.padded = true,
  });

  /// Horizontal padding that keeps content to [Breakpoints.content] wide.
  static double gutterFor(double width) =>
      math.max(AppSpace.gutter, (width - Breakpoints.content) / 2);

  @override
  Widget build(BuildContext context) {
    final canPop = automaticBack && (ModalRoute.of(context)?.canPop ?? false);
    final lead = leading ??
        (canPop
            ? Padding(
                padding: const EdgeInsets.only(left: 4),
                child: IconButton(
                  tooltip: 'Back',
                  icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20, color: AppColors.brand),
                  constraints: const BoxConstraints(minWidth: AppSpace.tap, minHeight: AppSpace.tap),
                  onPressed: () => Navigator.of(context).maybePop(),
                ),
              )
            : null);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        backgroundColor: AppColors.background,
        bottomNavigationBar: bottomBar == null
            ? null
            : _BottomBar(child: bottomBar!),
        body: LayoutBuilder(builder: (context, constraints) {
          final gutter = gutterFor(constraints.maxWidth);
          final bottomInset = MediaQuery.paddingOf(context).bottom;
          return CustomScrollView(
            controller: controller,
            physics: const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics()),
            slivers: [
              LargeTitleBar(title: title, leading: lead, actions: actions, gutter: gutter),
              if (onRefresh != null)
                CupertinoSliverRefreshControl(onRefresh: onRefresh),
              for (final s in slivers)
                padded
                    ? SliverPadding(padding: EdgeInsets.symmetric(horizontal: gutter), sliver: s)
                    : s,
              SliverToBoxAdapter(child: SizedBox(height: bottomInset + 24)),
            ],
          );
        }),
      ),
    );
  }
}

class _BottomBar extends StatelessWidget {
  final Widget child;
  const _BottomBar({required this.child});

  @override
  Widget build(BuildContext context) {
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.ink50.withValues(alpha: 0.88),
            border: const Border(top: BorderSide(color: AppColors.separator, width: 0.5)),
          ),
          child: SafeArea(
            top: false,
            child: LayoutBuilder(builder: (context, c) {
              final gutter = AppScaffold.gutterFor(c.maxWidth);
              return Padding(
                padding: EdgeInsets.fromLTRB(gutter, 12, gutter, 12),
                child: child,
              );
            }),
          ),
        ),
      ),
    );
  }
}

/// Pinned sliver header: large title that scrolls under a compact frosted bar.
class LargeTitleBar extends StatelessWidget {
  final String title;
  final Widget? leading;
  final List<Widget> actions;
  final double gutter;

  const LargeTitleBar({
    super.key,
    required this.title,
    this.leading,
    this.actions = const [],
    this.gutter = AppSpace.gutter,
  });

  @override
  Widget build(BuildContext context) {
    final topPad = MediaQuery.paddingOf(context).top;
    final scaler = MediaQuery.textScalerOf(context).clamp(maxScaleFactor: 1.6);
    final largeHeight = scaler.scale(34) * 1.25 + 14;
    return SliverPersistentHeader(
      pinned: true,
      delegate: _LargeTitleDelegate(
        title: title,
        leading: leading,
        actions: actions,
        topPad: topPad,
        barHeight: 52,
        largeHeight: largeHeight,
        gutter: gutter,
        scaler: scaler,
      ),
    );
  }
}

class _LargeTitleDelegate extends SliverPersistentHeaderDelegate {
  final String title;
  final Widget? leading;
  final List<Widget> actions;
  final double topPad;
  final double barHeight;
  final double largeHeight;
  final double gutter;
  final TextScaler scaler;

  _LargeTitleDelegate({
    required this.title,
    required this.leading,
    required this.actions,
    required this.topPad,
    required this.barHeight,
    required this.largeHeight,
    required this.gutter,
    required this.scaler,
  });

  @override
  double get minExtent => topPad + barHeight;

  @override
  double get maxExtent => topPad + barHeight + largeHeight;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    final range = maxExtent - minExtent;
    final t = (shrinkOffset / range).clamp(0.0, 1.0);
    final smallTitleOpacity = ((t - 0.75) / 0.25).clamp(0.0, 1.0);
    final collapsed = t >= 0.999 || (overlapsContent && t >= 0.999);
    final current = math.max(minExtent, maxExtent - shrinkOffset);

    Widget bar = Container(
      decoration: BoxDecoration(
        color: collapsed ? AppColors.ink50.withValues(alpha: 0.82) : AppColors.background,
        border: Border(
          bottom: BorderSide(
            color: collapsed ? AppColors.separator : Colors.transparent,
            width: 0.5,
          ),
        ),
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          // Compact bar
          Positioned(
            top: topPad,
            left: 0,
            right: 0,
            height: barHeight,
            child: NavigationToolbar(
              leading: leading,
              middle: Opacity(
                opacity: smallTitleOpacity,
                child: Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.navTitle,
                  textScaler: scaler,
                ),
              ),
              trailing: actions.isEmpty
                  ? null
                  : Padding(
                      padding: EdgeInsets.only(right: math.max(4, gutter - 12)),
                      child: Row(mainAxisSize: MainAxisSize.min, children: actions),
                    ),
              centerMiddle: true,
              middleSpacing: 8,
            ),
          ),
          // Large title
          Positioned(
            left: gutter,
            right: gutter,
            bottom: 8,
            child: ClipRect(
              child: Opacity(
                opacity: (1 - t * 1.4).clamp(0.0, 1.0),
                child: Semantics(
                  header: true,
                  child: Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppType.largeTitle,
                    textScaler: scaler,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );

    if (collapsed) {
      bar = ClipRect(
        child: BackdropFilter(filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20), child: bar),
      );
    }
    return SizedBox(height: current, child: bar);
  }

  @override
  bool shouldRebuild(covariant _LargeTitleDelegate old) =>
      old.title != title ||
      old.leading != leading ||
      old.actions != actions ||
      old.topPad != topPad ||
      old.largeHeight != largeHeight ||
      old.gutter != gutter;
}

/// Section heading used between content blocks on a page.
class SectionTitle extends StatelessWidget {
  final String text;
  final Widget? trailing;
  const SectionTitle(this.text, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 4, 0, 10),
      child: Row(
        children: [
          Expanded(child: Text(text, style: AppType.sectionTitle)),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}
