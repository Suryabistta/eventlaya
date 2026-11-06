import 'package:flutter/material.dart';
import 'frosted_tab_bar.dart';
import 'logo.dart';
import 'tokens.dart';

/// Builds a tab page. [active] is true while the tab is on screen, so pages
/// like the camera scanner can pause work when hidden.
typedef TabPageBuilder = Widget Function(BuildContext context, bool active);

class ShellTab {
  final TabItem item;
  final TabPageBuilder builder;
  const ShellTab({required this.item, required this.builder});
}

/// Gives descendants access to the shell (switch tabs from inside a page).
class ShellScope extends InheritedWidget {
  final int index;
  final ValueChanged<int> goTo;
  const ShellScope({super.key, required this.index, required this.goTo, required super.child});

  static ShellScope? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<ShellScope>();

  @override
  bool updateShouldNotify(ShellScope oldWidget) => oldWidget.index != index;
}

/// Tab shell: frosted bottom tab bar on phones, sidebar on tablets.
/// Tabs are built lazily on first visit and keep their state afterwards.
class AdaptiveShell extends StatefulWidget {
  final List<ShellTab> tabs;
  final int initialIndex;

  const AdaptiveShell({super.key, required this.tabs, this.initialIndex = 0});

  @override
  State<AdaptiveShell> createState() => _AdaptiveShellState();
}

class _AdaptiveShellState extends State<AdaptiveShell> {
  late int _index = widget.initialIndex;
  late final Set<int> _visited = {widget.initialIndex};

  void _goTo(int i) {
    if (i == _index) return;
    setState(() {
      _index = i;
      _visited.add(i);
    });
  }

  @override
  Widget build(BuildContext context) {
    final items = [for (final t in widget.tabs) t.item];
    final dark = items[_index].darkChrome;

    final stack = IndexedStack(
      index: _index,
      children: [
        for (var i = 0; i < widget.tabs.length; i++)
          _visited.contains(i)
              ? TickerMode(
                  enabled: i == _index,
                  child: widget.tabs[i].builder(context, i == _index),
                )
              : const SizedBox.shrink(),
      ],
    );

    return ShellScope(
      index: _index,
      goTo: _goTo,
      child: LayoutBuilder(builder: (context, constraints) {
        if (constraints.maxWidth >= Breakpoints.tablet) {
          final extended = constraints.maxWidth >= Breakpoints.wide;
          return Scaffold(
            backgroundColor: dark ? AppColors.ink950 : AppColors.background,
            body: Row(
              children: [
                SideBar(
                  items: items,
                  index: _index,
                  onTap: _goTo,
                  extended: extended,
                  header: extended
                      ? const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 20),
                          child: Align(alignment: Alignment.centerLeft, child: Wordmark(size: 28)),
                        )
                      : const LogoMark(size: 36),
                ),
                Expanded(
                  child: MediaQuery.removePadding(
                    context: context,
                    removeLeft: true,
                    child: stack,
                  ),
                ),
              ],
            ),
          );
        }
        return Scaffold(
          extendBody: true,
          backgroundColor: dark ? AppColors.ink950 : AppColors.background,
          body: stack,
          bottomNavigationBar: FrostedTabBar(
            items: items,
            index: _index,
            onTap: _goTo,
            dark: dark,
          ),
        );
      }),
    );
  }
}
