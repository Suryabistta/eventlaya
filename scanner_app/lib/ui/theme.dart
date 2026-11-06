import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'tokens.dart';

class AppTheme {
  AppTheme._();

  static TextTheme _textTheme(Color primary, Color secondary) => TextTheme(
        displayLarge: AppType.heading(48, weight: FontWeight.w800, color: primary),
        displayMedium: AppType.heading(40, weight: FontWeight.w800, color: primary),
        displaySmall: AppType.heading(34, weight: FontWeight.w800, color: primary),
        headlineLarge: AppType.heading(32, weight: FontWeight.w800, color: primary),
        headlineMedium: AppType.heading(26, weight: FontWeight.w700, color: primary),
        headlineSmall: AppType.heading(22, weight: FontWeight.w700, color: primary),
        titleLarge: AppType.heading(19, weight: FontWeight.w700, color: primary),
        titleMedium: AppType.body(16, weight: FontWeight.w600, color: primary),
        titleSmall: AppType.body(14, weight: FontWeight.w600, color: primary),
        bodyLarge: AppType.body(16, color: primary),
        bodyMedium: AppType.body(14, color: primary),
        bodySmall: AppType.body(12, color: secondary),
        labelLarge: AppType.body(15, weight: FontWeight.w600, color: primary),
        labelMedium: AppType.body(12, weight: FontWeight.w500, color: secondary),
        labelSmall: AppType.body(11, weight: FontWeight.w500, color: secondary),
      );

  /// Light theme used for organizer, admin and setup screens.
  static ThemeData get light {
    final text = _textTheme(AppColors.textPrimary, AppColors.textSecondary);
    const scheme = ColorScheme.light(
      primary: AppColors.brand,
      onPrimary: Colors.white,
      primaryContainer: AppColors.brandTint,
      onPrimaryContainer: AppColors.brandDark,
      secondary: AppColors.marigold,
      onSecondary: Colors.white,
      surface: AppColors.surface,
      onSurface: AppColors.textPrimary,
      onSurfaceVariant: AppColors.textSecondary,
      surfaceContainerHighest: AppColors.ink100,
      outline: AppColors.ink300,
      outlineVariant: AppColors.ink200,
      error: AppColors.danger,
      onError: Colors.white,
    );

    final fieldBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppRadius.md),
      borderSide: const BorderSide(color: AppColors.ink200),
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: scheme,
      scaffoldBackgroundColor: AppColors.background,
      canvasColor: AppColors.background,
      textTheme: text,
      primaryTextTheme: text,
      splashFactory: InkSparkle.splashFactory,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      visualDensity: VisualDensity.standard,
      iconTheme: const IconThemeData(color: AppColors.ink600, size: 22),
      dividerTheme: const DividerThemeData(
        color: AppColors.separator,
        thickness: 0.5,
        space: 0.5,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.background,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: true,
        foregroundColor: AppColors.brand,
        titleTextStyle: AppType.navTitle,
        systemOverlayStyle: SystemUiOverlayStyle.dark,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.brand,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AppColors.ink200,
          disabledForegroundColor: AppColors.ink400,
          minimumSize: const Size(AppSpace.tap, 50),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
          textStyle: AppType.body(16, weight: FontWeight.w600),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.brand,
          minimumSize: const Size(AppSpace.tap, AppSpace.tap),
          textStyle: AppType.body(15, weight: FontWeight.w500),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        isDense: false,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: fieldBorder,
        enabledBorder: fieldBorder,
        focusedBorder: fieldBorder.copyWith(
          borderSide: const BorderSide(color: AppColors.brand, width: 1.5),
        ),
        errorBorder: fieldBorder.copyWith(
          borderSide: const BorderSide(color: AppColors.danger),
        ),
        focusedErrorBorder: fieldBorder.copyWith(
          borderSide: const BorderSide(color: AppColors.danger, width: 1.5),
        ),
        hintStyle: AppType.body(15, color: AppColors.textTertiary),
        labelStyle: AppType.body(15, color: AppColors.textSecondary),
        errorStyle: AppType.body(12, color: AppColors.danger),
        prefixIconColor: AppColors.ink400,
        suffixIconColor: AppColors.ink400,
      ),
      textSelectionTheme: TextSelectionThemeData(
        cursorColor: AppColors.brand,
        selectionColor: AppColors.brand.withValues(alpha: 0.2),
        selectionHandleColor: AppColors.brand,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: const WidgetStatePropertyAll(Colors.white),
        trackColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? AppColors.success : AppColors.ink200,
        ),
        trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AppColors.brand,
        linearTrackColor: AppColors.ink100,
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        modalBackgroundColor: AppColors.surface,
        showDragHandle: true,
        dragHandleColor: AppColors.ink300,
        dragHandleSize: Size(36, 5),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.xl)),
        ),
        clipBehavior: Clip.antiAlias,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.lg)),
        titleTextStyle: AppType.heading(19),
        contentTextStyle: AppType.body(14, color: AppColors.textSecondary),
      ),
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: CupertinoPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.linux: CupertinoPageTransitionsBuilder(),
          TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.windows: CupertinoPageTransitionsBuilder(),
        },
      ),
    );
  }

  /// Dark theme for the camera scanner.
  static ThemeData get scanner {
    final base = light;
    final text = _textTheme(Colors.white, AppColors.ink300);
    return base.copyWith(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: AppColors.ink950,
      canvasColor: AppColors.ink950,
      textTheme: text,
      primaryTextTheme: text,
      iconTheme: const IconThemeData(color: Colors.white, size: 22),
      colorScheme: base.colorScheme.copyWith(
        brightness: Brightness.dark,
        surface: AppColors.ink900,
        onSurface: Colors.white,
        onSurfaceVariant: AppColors.ink300,
      ),
      appBarTheme: base.appBarTheme.copyWith(
        backgroundColor: AppColors.ink950,
        foregroundColor: Colors.white,
        titleTextStyle: AppType.navTitle.copyWith(color: Colors.white),
        systemOverlayStyle: SystemUiOverlayStyle.light,
      ),
    );
  }
}
