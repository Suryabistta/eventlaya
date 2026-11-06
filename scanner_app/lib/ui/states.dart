import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';
import 'buttons.dart';
import 'grouped.dart';
import 'tokens.dart';

/// Friendly empty state that points at the next action.
class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final IconData? actionIcon;
  final VoidCallback? onAction;
  final bool onDark;

  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.actionIcon,
    this.onAction,
    this.onDark = false,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: onDark ? Colors.white.withValues(alpha: 0.08) : AppColors.ink100,
                  borderRadius: BorderRadius.circular(AppRadius.lg + 2),
                ),
                child: Icon(icon, size: 30, color: onDark ? AppColors.ink300 : AppColors.ink500),
              ),
              const SizedBox(height: 16),
              Text(
                title,
                textAlign: TextAlign.center,
                style: AppType.heading(20, color: onDark ? Colors.white : AppColors.textPrimary),
              ),
              const SizedBox(height: 6),
              Text(
                message,
                textAlign: TextAlign.center,
                style: AppType.body(14,
                    color: onDark ? AppColors.ink300 : AppColors.textSecondary, height: 1.45),
              ),
              if (actionLabel != null && onAction != null) ...[
                const SizedBox(height: 20),
                PrimaryButton(
                  label: actionLabel!,
                  icon: actionIcon,
                  onPressed: onAction,
                  expand: false,
                  tonal: true,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Error state with a retry button.
class ErrorState extends StatelessWidget {
  final String title;
  final String message;
  final VoidCallback onRetry;

  const ErrorState({
    super.key,
    this.title = "Couldn't load this",
    required this.message,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: AppColors.dangerTint,
                  borderRadius: BorderRadius.circular(AppRadius.lg + 2),
                ),
                child: const Icon(Icons.cloud_off_rounded, size: 30, color: AppColors.danger),
              ),
              const SizedBox(height: 16),
              Text(title, textAlign: TextAlign.center, style: AppType.heading(20)),
              const SizedBox(height: 6),
              Text(
                message,
                textAlign: TextAlign.center,
                style: AppType.body(14, color: AppColors.textSecondary, height: 1.45),
              ),
              const SizedBox(height: 20),
              PrimaryButton(
                label: 'Try again',
                icon: Icons.refresh_rounded,
                onPressed: onRetry,
                expand: false,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Shimmering placeholder block.
class ShimmerBox extends StatelessWidget {
  final double? width;
  final double height;
  final double radius;
  const ShimmerBox({super.key, this.width, required this.height, this.radius = 6});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: AppColors.ink100,
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}

/// Wraps [child] in the brand shimmer effect. Shimmer runs only while data loads.
class AppShimmer extends StatelessWidget {
  final Widget child;
  const AppShimmer({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: AppColors.ink100,
      highlightColor: AppColors.ink50,
      period: const Duration(milliseconds: 1400),
      child: child,
    );
  }
}

/// Placeholder grouped list shown while a list loads.
class LoadingList extends StatelessWidget {
  final int rows;
  final bool avatar;
  const LoadingList({super.key, this.rows = 6, this.avatar = true});

  @override
  Widget build(BuildContext context) {
    return AppShimmer(
      child: GroupedSection(
        children: [
          for (var i = 0; i < rows; i++)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                children: [
                  if (avatar) ...[
                    const ShimmerBox(width: 40, height: 40, radius: 20),
                    const SizedBox(width: 12),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        ShimmerBox(width: 120.0 + (i % 3) * 40, height: 14),
                        const SizedBox(height: 8),
                        ShimmerBox(width: 80.0 + (i % 2) * 50, height: 11),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  const ShimmerBox(width: 64, height: 20, radius: 10),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Placeholder grid of stat tiles.
class LoadingStats extends StatelessWidget {
  final int columns;
  const LoadingStats({super.key, this.columns = 2});

  @override
  Widget build(BuildContext context) {
    return AppShimmer(
      child: Column(
        children: [
          const ShimmerBox(height: 92, radius: 14),
          const SizedBox(height: 12),
          GridView.count(
            crossAxisCount: columns,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.6,
            children: List.generate(4, (_) => const ShimmerBox(height: 90, radius: 14)),
          ),
        ],
      ),
    );
  }
}
