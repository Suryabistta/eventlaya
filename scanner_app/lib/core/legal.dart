import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../ui/ui.dart';

/// Legal pages and support contact. The pages live on the Eventlaya website
/// (frontend/src/pages/legal, config in frontend/src/lib/legal.ts) and are
/// always public — they are not a superadmin module. The base URL is the
/// public website, not the (developer-changeable) API server.
class Legal {
  Legal._();

  static const baseUrl = 'https://eventlaya.com';
  static const supportEmail = 'support@eventlaya.com';

  static const privacy = '/privacy';
  static const terms = '/terms';
  static const community = '/community-guidelines';
  static const deleteAccount = '/delete-account';
  static const contact = '/contact';

  static Uri url(String path) => Uri.parse('$baseUrl$path');
}

/// Opens a legal page (e.g. [Legal.privacy]) in an in-app browser tab.
/// Falls back to the external browser, then to copying the link.
Future<void> openLegal(BuildContext context, String path) async {
  final uri = Legal.url(path);
  try {
    if (await launchUrl(uri, mode: LaunchMode.inAppBrowserView)) return;
  } catch (_) {
    // No Custom Tabs provider: try a normal browser below.
  }
  try {
    if (await launchUrl(uri, mode: LaunchMode.externalApplication)) return;
  } catch (_) {}
  await Clipboard.setData(ClipboardData(text: uri.toString()));
  if (context.mounted) AppToast.info(context, 'Link copied: ${uri.toString().replaceFirst('https://', '')}');
}

/// Starts an email to support (optionally with a subject). Without an email
/// app, copies the address instead.
Future<void> contactSupport(BuildContext context, {String subject = 'Eventlaya app'}) async {
  final uri = Uri(
    scheme: 'mailto',
    path: Legal.supportEmail,
    query: 'subject=${Uri.encodeComponent(subject)}',
  );
  try {
    if (await launchUrl(uri)) return;
  } catch (_) {}
  await Clipboard.setData(const ClipboardData(text: Legal.supportEmail));
  if (context.mounted) AppToast.info(context, 'Email address copied: ${Legal.supportEmail}');
}

/// "Privacy & support" rows for Profile / More / Account screens.
/// [deleteInfo] links to the public page explaining account deletion (the
/// in-app "Delete account" action stays where it is).
class LegalSection extends StatelessWidget {
  final bool deleteInfo;
  const LegalSection({super.key, this.deleteInfo = true});

  @override
  Widget build(BuildContext context) {
    return GroupedSection(
      header: 'Privacy & support',
      separatorInset: 58,
      children: [
        ListRow(
          leading: const RowIcon(Icons.privacy_tip_outlined, background: AppColors.ink500),
          title: 'Privacy policy',
          chevron: true,
          onTap: () => openLegal(context, Legal.privacy),
        ),
        ListRow(
          leading: const RowIcon(Icons.description_outlined, background: AppColors.ink500),
          title: 'Terms of service',
          chevron: true,
          onTap: () => openLegal(context, Legal.terms),
        ),
        if (deleteInfo)
          ListRow(
            leading: const RowIcon(Icons.person_remove_outlined, background: AppColors.ink500),
            title: 'Delete account info',
            subtitle: 'What gets deleted and how',
            chevron: true,
            onTap: () => openLegal(context, Legal.deleteAccount),
          ),
        ListRow(
          leading: const RowIcon(Icons.mail_outline_rounded, background: AppColors.ink500),
          title: 'Contact support',
          subtitle: Legal.supportEmail,
          onTap: () => contactSupport(context),
        ),
      ],
    );
  }
}

/// "By continuing you agree to the Terms of service and Privacy policy." with
/// tappable links, for sign-in / sign-up.
class LegalConsentText extends StatelessWidget {
  final String lead;
  final TextAlign textAlign;
  const LegalConsentText({
    super.key,
    this.lead = 'By continuing you agree to the',
    this.textAlign = TextAlign.center,
  });

  @override
  Widget build(BuildContext context) {
    final style = AppType.body(12.5, color: AppColors.textSecondary);
    InlineSpan link(String label, String path) => WidgetSpan(
          alignment: PlaceholderAlignment.baseline,
          baseline: TextBaseline.alphabetic,
          child: Semantics(
            link: true,
            child: GestureDetector(
              onTap: () => openLegal(context, path),
              behavior: HitTestBehavior.opaque,
              child: Text(
                label,
                style: style.copyWith(
                  color: AppColors.ink800,
                  fontWeight: FontWeight.w600,
                  decoration: TextDecoration.underline,
                  decorationColor: AppColors.ink300,
                ),
              ),
            ),
          ),
        );
    return Text.rich(
      TextSpan(style: style, children: [
        TextSpan(text: '$lead '),
        link('Terms of service', Legal.terms),
        const TextSpan(text: ' and '),
        link('Privacy policy', Legal.privacy),
        const TextSpan(text: '.'),
      ]),
      textAlign: textAlign,
    );
  }
}
