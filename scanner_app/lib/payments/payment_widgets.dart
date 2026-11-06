import 'package:flutter/material.dart';
import '../ui/ui.dart';
import 'payment_models.dart';

/// Brand colours for the payment marks (same as the web's PROVIDER_BRAND).
({Color bg, Color fg, String mark}) providerBrand(String id) => switch (id) {
      'khalti' => (bg: const Color(0xFF5C2D91), fg: Colors.white, mark: 'K'),
      'esewa' => (bg: const Color(0xFF60BB46), fg: Colors.white, mark: 'e'),
      'test' => (bg: AppColors.ink900, fg: Colors.white, mark: 'T'),
      _ => (bg: AppColors.ink100, fg: AppColors.ink900, mark: 'Rs'),
    };

class ProviderMark extends StatelessWidget {
  final String id;
  final double size;
  const ProviderMark(this.id, {super.key, this.size = 34});

  @override
  Widget build(BuildContext context) {
    final b = providerBrand(id);
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: b.bg, borderRadius: BorderRadius.circular(size * 0.28)),
      child: Text(
        b.mark,
        textScaler: TextScaler.noScaling,
        style: AppType.heading(b.mark.length > 1 ? size * 0.36 : size * 0.52, weight: FontWeight.w800, color: b.fg),
      ),
    );
  }
}

/// "How do you want to pay?": online providers, and the venue when allowed.
/// [selected] is a provider id or 'venue'.
class PaymentMethodPicker extends StatelessWidget {
  final List<PaymentProviderInfo> providers;
  final bool venue;
  final String? venueBlockedReason;
  final double amount;
  final String? selected;
  final ValueChanged<String> onChanged;
  final String header;
  final String? footer;

  const PaymentMethodPicker({
    super.key,
    required this.providers,
    required this.venue,
    required this.amount,
    required this.selected,
    required this.onChanged,
    this.venueBlockedReason,
    this.header = 'How do you want to pay?',
    this.footer,
  });

  /// Choices in order (online first, like the web), skipping Khalti under Rs 10.
  static List<String> choices(List<PaymentProviderInfo> providers, bool venue, double amount) => [
        for (final p in providers)
          if (p.accepts(amount)) p.id,
        if (venue) 'venue',
      ];

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[
      for (final p in providers)
        _Choice(
          id: p.id,
          title: p.name,
          subtitle: !p.accepts(amount)
              ? 'Takes Rs 10 or more'
              : p.id == 'test'
                  ? 'Test mode — no real money'
                  : p.sandbox
                      ? 'Sandbox (test) account'
                      : 'Pay now${p.id == 'khalti' ? ' with your Khalti wallet, bank or card' : p.id == 'esewa' ? ' with your eSewa wallet' : ''}',
          selected: selected == p.id,
          enabled: p.accepts(amount),
          onTap: () => onChanged(p.id),
        ),
      if (venue)
        _Choice(
          id: 'venue',
          title: 'Pay at the venue',
          subtitle: 'Cash or QR at the gate when you arrive',
          selected: selected == 'venue',
          enabled: true,
          onTap: () => onChanged('venue'),
        ),
    ];
    return GroupedSection(
      header: header,
      separatorInset: 62,
      footer: venueBlockedReason ?? footer,
      children: rows,
    );
  }
}

class _Choice extends StatelessWidget {
  final String id;
  final String title;
  final String subtitle;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;
  const _Choice({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      inMutuallyExclusiveGroup: true,
      child: Opacity(
        opacity: enabled ? 1 : 0.45,
        child: ListRow(
          leading: ProviderMark(id),
          title: title,
          subtitle: subtitle,
          trailing: Icon(
            selected ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded,
            color: selected ? AppColors.brand : AppColors.ink300,
          ),
          onTap: enabled ? onTap : null,
        ),
      ),
    );
  }
}
