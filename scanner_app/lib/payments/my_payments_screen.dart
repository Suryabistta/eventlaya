import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../attendee/screens/link_screens.dart';
import '../core/api_client.dart';
import '../models/ticket_type_model.dart';
import '../providers/auth_provider.dart';
import '../providers/modules_provider.dart';
import '../ui/ui.dart';
import 'payment_api.dart';
import 'payment_widgets.dart';

/// Profile → My payments: tickets and vote packs paid online.
///
/// Signed in: the account's payments from every device (`GET /api/payments/mine/`) merged with the ones
/// started on this phone (signed out, or before signing in), which are marked "This phone only".
/// Signed out: this phone's history. Each row shows its live status; tap to see it (and its passes /
/// votes once paid).
class MyPaymentsScreen extends ConsumerStatefulWidget {
  final PaymentApi? api;
  const MyPaymentsScreen({super.key, this.api});

  @override
  ConsumerState<MyPaymentsScreen> createState() => _MyPaymentsScreenState();
}

class _MyPaymentsScreenState extends ConsumerState<MyPaymentsScreen> {
  late final PaymentApi _api = widget.api ?? PaymentApi();
  List<PaymentRecord>? _list;
  String? _notice;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final signedIn = ref.read(authProvider).user != null;
    var phone = await PaymentHistory.load();
    var account = const <PaymentRecord>[];
    String? notice;
    if (signedIn) {
      try {
        account = await _api.mine();
      } catch (e) {
        if (ApiClient.isModuleDisabled(e)) {
          noteModuleDisabled(ref, e);
          notice = "Online payments are switched off, so your account's payments can't be shown right now.";
        } else if (e is DioException && e.response?.statusCode != 401) {
          notice = "Couldn't load your account's payments. Showing the ones made on this phone.";
        }
      }
    }
    if (!mounted) return;
    setState(() {
      _list = PaymentRecord.merge(account, phone);
      _notice = notice;
    });
    // Refresh the phone-only ones that could still change (the account's come fresh from the server).
    final stale = phone.where((r) => !account.any((a) => a.id == r.id) && (r.status == 'created' || r.status == 'pending'));
    var changed = false;
    for (final r in stale.take(15)) {
      try {
        final i = await _api.intent(r.id);
        if (i.status != r.status) {
          await PaymentHistory.updateStatus(r.id, i.status);
          changed = true;
        }
      } catch (_) {}
    }
    if (changed && mounted) {
      phone = await PaymentHistory.load();
      if (mounted) setState(() => _list = PaymentRecord.merge(account, phone));
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _list;
    final signedIn = ref.watch(authProvider.select((s) => s.user != null));
    return AppScaffold(
      title: 'My payments',
      onRefresh: _load,
      slivers: [
        if (_notice != null)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Tone.warning.tint, borderRadius: BorderRadius.circular(12)),
                child: Text(_notice!, style: AppType.body(13.5, weight: FontWeight.w500, color: AppColors.ink800)),
              ),
            ),
          ),
        if (list == null)
          const SliverToBoxAdapter(child: LoadingList(rows: 4))
        else if (list.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.receipt_long_rounded,
              title: 'No payments yet',
              message: signedIn
                  ? 'Tickets and vote packs you pay for online show here, from any device you sign in on.'
                  : 'Tickets and vote packs you pay for online in this app show here. Sign in to see them on every device.',
            ),
          )
        else
          SliverToBoxAdapter(
            child: GroupedSection(
              footer: signedIn
                  ? 'Payments on your account, from any device. "This phone only" ones were made signed out. Refunds are handled by the organizer.'
                  : 'Payments made on this phone. Sign in to see your account\'s payments from other devices too.',
              separatorInset: 62,
              children: [for (final r in list) _row(r, signedIn)],
            ),
          ),
      ],
    );
  }

  Widget _row(PaymentRecord r, bool signedIn) {
    final title = r.description.isEmpty ? (r.purpose == 'vote_pack' ? 'Vote pack' : 'Tickets') : r.description;
    final lines = [
      '${DateFormat('d MMM y, h:mm a').format(r.createdAt.toLocal())} · ${formatRupees(r.amount)}',
      if (r.summary != null && r.summary != title) r.summary!,
    ];
    return ListRow(
      leading: ProviderMark(r.provider ?? 'venue'),
      title: title,
      subtitleWidget: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        for (final l in lines) Text(l, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.rowSubtitle),
        if (signedIn && !r.onAccount)
          Padding(
            padding: const EdgeInsets.only(top: 3),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.phone_android_rounded, size: 13, color: AppColors.ink400),
              const SizedBox(width: 3),
              Text('This phone only', style: AppType.body(11.5, weight: FontWeight.w600, color: AppColors.ink500)),
            ]),
          ),
      ]),
      trailing: _StatusPill(r.status),
      onTap: () async {
        await openPaymentResult(Navigator.of(context), r.id);
        _load();
      },
    );
  }
}

class _StatusPill extends StatelessWidget {
  final String status;
  const _StatusPill(this.status);

  @override
  Widget build(BuildContext context) {
    final (label, tone) = switch (status) {
      'paid' => ('Paid', Tone.success),
      'pending' || 'created' => ('Pending', Tone.warning),
      'refunded' => ('Refunded', Tone.neutral),
      'expired' => ('Expired', Tone.neutral),
      'cancelled' => ('Cancelled', Tone.neutral),
      _ => ('Failed', Tone.danger),
    };
    return StatusBadge(label, tone: tone, dot: false);
  }
}
