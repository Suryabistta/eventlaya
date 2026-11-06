import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Eventlaya brand palette — matches the web app.
class AppColors {
  AppColors._();

  // Brand: "Laliguras" rhododendron
  static const brand = Color(0xFFC2215A);
  static const brandDark = Color(0xFFA3184A);
  static const brandTint = Color(0xFFFDF2F6);

  // Marigold — warnings and gate-out
  static const marigold = Color(0xFFE39400);
  static const marigoldDark = Color(0xFFB57600);
  static const marigoldTint = Color(0xFFFFF7E6);

  // Emerald — success and gate-in
  static const success = Color(0xFF15803D);
  static const successTint = Color(0xFFECFDF5);

  // Danger
  static const danger = Color(0xFFDC2626);
  static const dangerTint = Color(0xFFFEF2F2);

  // Ink — plum-tinted neutrals
  static const ink50 = Color(0xFFFAF8FB);
  static const ink100 = Color(0xFFF3F0F5);
  static const ink200 = Color(0xFFE7E2EB);
  static const ink300 = Color(0xFFD3CCD9);
  static const ink400 = Color(0xFF7B7186);
  static const ink500 = Color(0xFF635A6E);
  static const ink600 = Color(0xFF4E4659);
  static const ink700 = Color(0xFF3D3547);
  static const ink800 = Color(0xFF2A2333);
  static const ink900 = Color(0xFF1C1724);
  static const ink950 = Color(0xFF110D17);

  // Semantic aliases
  static const background = ink50;
  static const surface = Colors.white;
  static const textPrimary = ink900;
  static const textSecondary = ink500;
  static const textTertiary = ink400;
  static const separator = ink200;
  static const gateIn = success;
  static const gateOut = marigold;
}

/// Spacing, radii and sizing.
class AppSpace {
  AppSpace._();
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;

  /// Horizontal page gutter on phones.
  static const double gutter = 16;

  /// Minimum tap target (iOS HIG).
  static const double tap = 44;
}

class AppRadius {
  AppRadius._();
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
}

class Breakpoints {
  Breakpoints._();

  /// At or above this width, the shell switches from a bottom tab bar to a sidebar.
  static const double tablet = 700;

  /// At or above this width the sidebar shows labels next to icons.
  static const double wide = 1100;

  /// Max width of page content.
  static const double content = 980;

  static bool isTablet(BuildContext context) =>
      MediaQuery.sizeOf(context).width >= tablet;
}

/// Type helpers. Only weights bundled in assets/google_fonts are used:
/// Bricolage Grotesque 500–800, Poppins 400–700, JetBrains Mono 400–700.
class AppType {
  AppType._();

  static TextStyle heading(
    double size, {
    FontWeight weight = FontWeight.w700,
    Color color = AppColors.textPrimary,
    double? height,
  }) =>
      GoogleFonts.bricolageGrotesque(
        fontSize: size,
        fontWeight: weight,
        color: color,
        height: height ?? 1.15,
        letterSpacing: -0.02 * size,
      );

  static TextStyle body(
    double size, {
    FontWeight weight = FontWeight.w400,
    Color color = AppColors.textPrimary,
    double? height,
  }) =>
      GoogleFonts.poppins(
        fontSize: size,
        fontWeight: weight,
        color: color,
        height: height ?? 1.4,
      );

  static TextStyle mono(
    double size, {
    FontWeight weight = FontWeight.w500,
    Color color = AppColors.textPrimary,
  }) =>
      GoogleFonts.jetBrainsMono(
        fontSize: size,
        fontWeight: weight,
        color: color,
        height: 1.3,
      );

  // Common presets
  static TextStyle get largeTitle => heading(32, weight: FontWeight.w800);
  static TextStyle get navTitle => heading(17, weight: FontWeight.w700);
  static TextStyle get sectionTitle => heading(20, weight: FontWeight.w700);
  static TextStyle get rowTitle => body(15, weight: FontWeight.w500);
  static TextStyle get rowSubtitle =>
      body(13, color: AppColors.textSecondary, height: 1.35);
  static TextStyle get caption =>
      body(12, color: AppColors.textSecondary, height: 1.35);
  static TextStyle get groupHeader =>
      body(13, weight: FontWeight.w500, color: AppColors.ink500);
}
