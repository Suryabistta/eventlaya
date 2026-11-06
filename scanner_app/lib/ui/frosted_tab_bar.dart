import 'dart:ui';
import 'package:flutter/material.dart';
import 'tokens.dart';

class TabItem {
  final String label;
  final IconData icon;
  final IconData activeIcon;

  /// Use dark chrome while this tab is active (e.g. the camera scanner).
  final bool darkChrome;

  /// Render as a raised circular button in the tab bar (e.g. the centre Scan tab).
  final bool prominent;

  /// Count shown on the icon (e.g. unread chat messages); 0 hides it.
  final int badge;

  const TabItem({
    required this.label,
    required this.icon,
    required this.activeIcon,
    this.darkChrome = false,
    this.prominent = false,
    this.badge = 0,
  });
}

/// Floating glass tab bar (iPhone style): a rounded pill that hovers above
/// the bottom safe area with side margins, a strong backdrop blur, a
/// translucent fill, a hairline border and a soft shadow. A [TabItem.prominent]
/// item renders as a raised circular button in the middle.
///
/// Put it in `Scaffold.bottomNavigationBar` with `extendBody: true`: the
/// Scaffold then reports the bar's full height (pill + margins + safe area)
/// as bottom padding to the page, so content scrolls clear of it.
class FrostedTabBar extends StatelessWidget {
  final List<TabItem> items;
  final int index;
  final ValueChanged<int> onTap;
  final bool dark;

  const FrostedTabBar({
    super.key,
    required this.items,
    required this.index,
    required this.onTap,
    this.dark = false,
  });

  /// Height of the pill itself.
  static const double barHeight = 64;

  /// Gap between the pill and the bottom safe area.
  static const double floatGap = 12;

  /// Side margin on phones.
  static const double sideMargin = 16;

  /// Widest the pill gets (centred on large phones / landscape).
  static const double maxWidth = 520;

  @override
  Widget build(BuildContext context) {
    final bg = dark ? AppColors.ink900.withValues(alpha: 0.62) : Colors.white.withValues(alpha: 0.68);
    final border = dark ? Colors.white.withValues(alpha: 0.14) : Colors.white.withValues(alpha: 0.9);
    final outline = dark ? Colors.black.withValues(alpha: 0.3) : AppColors.ink200.withValues(alpha: 0.8);
    final inactive = dark ? AppColors.ink300 : AppColors.ink500;
    final active = dark ? Colors.white : AppColors.brand;
    final scaler = MediaQuery.textScalerOf(context).clamp(maxScaleFactor: 1.3);
    final safeBottom = MediaQuery.paddingOf(context).bottom;
    final height = barHeight + (scaler.scale(11) - 11);
    final radius = BorderRadius.circular(height / 2);

    return Padding(
      padding: EdgeInsets.fromLTRB(sideMargin, 0, sideMargin, safeBottom + floatGap),
      child: Center(
        heightFactor: 1,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: maxWidth),
          child: SizedBox(
            height: height,
            // Only the glass is clipped, so a prominent button can rise above it.
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned.fill(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      borderRadius: radius,
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.ink900.withValues(alpha: dark ? 0.4 : 0.14),
                          blurRadius: 30,
                          offset: const Offset(0, 10),
                        ),
                        BoxShadow(
                          color: AppColors.ink900.withValues(alpha: dark ? 0.2 : 0.05),
                          blurRadius: 4,
                          offset: const Offset(0, 1),
                        ),
                      ],
                    ),
                    child: ClipRRect(
                      borderRadius: radius,
                      child: BackdropFilter(
                        filter: ImageFilter.blur(sigmaX: 30, sigmaY: 30),
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: bg,
                            borderRadius: radius,
                            border: Border.all(color: outline, width: 0.5),
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                Colors.white.withValues(alpha: dark ? 0.06 : 0.35),
                                Colors.white.withValues(alpha: 0),
                              ],
                            ),
                          ),
                          // Inner top highlight, like light catching glass.
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              borderRadius: radius,
                              border: Border(top: BorderSide(color: border, width: 0.8)),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  child: Row(
                    children: [
                      for (var i = 0; i < items.length; i++)
                        Expanded(
                          child: items[i].prominent
                              ? _ProminentTabButton(
                                  item: items[i],
                                  selected: i == index,
                                  dark: dark,
                                  onTap: () => onTap(i),
                                )
                              : _TabButton(
                                  item: items[i],
                                  selected: i == index,
                                  color: i == index ? active : inactive,
                                  highlight: dark
                                      ? Colors.white.withValues(alpha: 0.12)
                                      : AppColors.brand.withValues(alpha: 0.09),
                                  scaler: scaler,
                                  onTap: () => onTap(i),
                                ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TabButton extends StatelessWidget {
  final TabItem item;
  final bool selected;
  final Color color;
  final Color highlight;
  final TextScaler scaler;
  final VoidCallback onTap;

  const _TabButton({
    required this.item,
    required this.selected,
    required this.color,
    required this.highlight,
    required this.scaler,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: item.badge > 0 ? '${item.label}, ${item.badge} unread' : item.label,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 6),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOutCubic,
            decoration: BoxDecoration(
              color: selected ? highlight : Colors.transparent,
              borderRadius: BorderRadius.circular(26),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _Badged(
                  count: item.badge,
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 150),
                    child: Icon(
                      selected ? item.activeIcon : item.icon,
                      key: ValueKey(selected),
                      size: 24,
                      color: color,
                    ),
                  ),
                ),
                const SizedBox(height: 2),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  // Shrink a long label to fit rather than cut it ("Attend…").
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      item.label,
                      maxLines: 1,
                      textScaler: scaler,
                      style: AppType.body(10.5,
                          weight: selected ? FontWeight.w600 : FontWeight.w500, color: color, height: 1.2),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Raised circular centre button, lifted above the floating bar.
class _ProminentTabButton extends StatelessWidget {
  final TabItem item;
  final bool selected;
  final bool dark;
  final VoidCallback onTap;

  const _ProminentTabButton({
    required this.item,
    required this.selected,
    required this.dark,
    required this.onTap,
  });

  static const _size = 60.0;
  static const _lift = 14.0;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: item.label,
      excludeSemantics: true,
      child: OverflowBox(
        maxHeight: _size + _lift,
        alignment: Alignment.topCenter,
        child: Transform.translate(
          offset: const Offset(0, -_lift),
          child: GestureDetector(
            onTap: onTap,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: _size,
              height: _size,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: selected
                      ? const [AppColors.brand, AppColors.brandDark]
                      : const [Color(0xFFD63A70), AppColors.brand],
                ),
                border: Border.all(
                  color: dark ? Colors.white.withValues(alpha: 0.22) : Colors.white,
                  width: 3.5,
                ),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.brand.withValues(alpha: selected ? 0.5 : 0.35),
                    blurRadius: 18,
                    offset: const Offset(0, 6),
                  ),
                ],
              ),
              child: Icon(selected ? item.activeIcon : item.icon, color: Colors.white, size: 27),
            ),
          ),
        ),
      ),
    );
  }
}

/// Sidebar used instead of the tab bar on tablets.
class SideBar extends StatelessWidget {
  final List<TabItem> items;
  final int index;
  final ValueChanged<int> onTap;
  final bool extended;
  final Widget? header;
  final Widget? footer;

  const SideBar({
    super.key,
    required this.items,
    required this.index,
    required this.onTap,
    this.extended = false,
    this.header,
    this.footer,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: extended ? 232 : 92,
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(right: BorderSide(color: AppColors.separator, width: 0.5)),
      ),
      child: SafeArea(
        right: false,
        child: Column(
          crossAxisAlignment: extended ? CrossAxisAlignment.stretch : CrossAxisAlignment.center,
          children: [
            const SizedBox(height: 16),
            if (header != null) ...[header!, const SizedBox(height: 20)],
            for (var i = 0; i < items.length; i++)
              Padding(
                padding: EdgeInsets.symmetric(horizontal: extended ? 12 : 8, vertical: 3),
                child: _SideItem(
                  item: items[i],
                  selected: i == index,
                  extended: extended,
                  onTap: () => onTap(i),
                ),
              ),
            const Spacer(),
            if (footer != null) footer!,
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
  }
}

class _SideItem extends StatelessWidget {
  final TabItem item;
  final bool selected;
  final bool extended;
  final VoidCallback onTap;
  const _SideItem({required this.item, required this.selected, required this.extended, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final color = selected ? AppColors.brand : AppColors.ink500;
    final icon = _Badged(count: item.badge, child: Icon(selected ? item.activeIcon : item.icon, color: color, size: 24));
    final label = Text(
      item.label,
      maxLines: extended ? 1 : 2,
      overflow: TextOverflow.ellipsis,
      textAlign: extended ? TextAlign.start : TextAlign.center,
      style: AppType.body(extended ? 15 : 12,
          weight: selected ? FontWeight.w600 : FontWeight.w500,
          color: selected ? AppColors.brand : AppColors.ink600),
    );
    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: selected ? AppColors.brandTint : Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.md),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 52, minWidth: 72),
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: extended ? 12 : 4, vertical: 8),
              child: extended
                  ? Row(children: [icon, const SizedBox(width: 12), Expanded(child: label)])
                  : Column(mainAxisSize: MainAxisSize.min, children: [icon, const SizedBox(height: 4), label]),
            ),
          ),
        ),
      ),
    );
  }
}

/// Small count bubble on a tab icon.
class _Badged extends StatelessWidget {
  final int count;
  final Widget child;
  const _Badged({required this.count, required this.child});

  @override
  Widget build(BuildContext context) {
    if (count <= 0) return child;
    return Stack(clipBehavior: Clip.none, children: [
      child,
      Positioned(
        right: -9,
        top: -4,
        child: Container(
          constraints: const BoxConstraints(minWidth: 17),
          height: 17,
          padding: const EdgeInsets.symmetric(horizontal: 4),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.danger,
            borderRadius: BorderRadius.circular(9),
            border: Border.all(color: Colors.white, width: 1.5),
          ),
          child: Text(
            count > 99 ? '99+' : '$count',
            textScaler: TextScaler.noScaling,
            style: AppType.body(10, weight: FontWeight.w700, color: Colors.white, height: 1.1),
          ),
        ),
      ),
    ]);
  }
}
