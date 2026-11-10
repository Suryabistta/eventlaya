import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:printing/printing.dart';
import '../../core/api_client.dart';
import '../../core/bs_date.dart';
import '../../ui/ui.dart';
import '../../attendee/data/attendee_api.dart' show friendlyError;
import '../../attendee/widgets/attendee_widgets.dart' show AsyncErrorView;

/// Vendor / venue bookings (server: apps/marketplace/bookings.py): confirmed requests and bookings the owner added,
/// with the agreed amount, payments received outside Eventlaya (records only), the balance and a PDF receipt.
class Booking {
  final Map<String, dynamic> raw;
  Booking(this.raw);

  String get id => raw['id'].toString();
  String get kind => raw['kind'].toString();
  String get state => raw['state'].toString();
  String get paymentState => raw['payment_state'].toString();
  String get customer => (raw['customer'] as Map)['name'].toString();
  String get phone => (raw['customer'] as Map)['phone']?.toString() ?? '';
  String get listing => raw['listing'].toString();
  String? get space => raw['space']?.toString();
  DateTime? get date => DateTime.tryParse(raw['date']?.toString() ?? '');
  String get time {
    final s = raw['start_time']?.toString(), e = raw['end_time']?.toString();
    return s == null || e == null ? 'Whole day' : '${s.substring(0, 5)}–${e.substring(0, 5)}';
  }
  double? get agreed => double.tryParse(raw['agreed_amount']?.toString() ?? '');
  double get paid => double.tryParse(raw['paid']?.toString() ?? '') ?? 0;
  double? get balance => double.tryParse(raw['balance']?.toString() ?? '');
  List<Map<String, dynamic>> get payments => [for (final p in (raw['payments'] as List? ?? const [])) Map<String, dynamic>.from(p as Map)];
  String get path => '/api/marketplace/my/bookings/$kind/$id/';
}

final _bookingsApi = Provider((ref) => ApiClient());
final bookingsFilterProvider = StateProvider<String>((ref) => 'upcoming');
final bookingsProvider = FutureProvider.autoDispose<(List<Booking>, Map<String, dynamic>)>((ref) async {
  final filter = ref.watch(bookingsFilterProvider);
  final resp = await ref.watch(_bookingsApi).get('/api/marketplace/my/bookings/', queryParameters: {'filter': filter});
  final data = Map<String, dynamic>.from(resp.data as Map);
  return ([for (final b in data['results'] as List) Booking(Map<String, dynamic>.from(b as Map))], Map<String, dynamic>.from(data['totals'] as Map));
});

String _rs(num? v) => v == null ? '–' : 'Rs ${NumberFormat.decimalPattern().format(v)}';

class BookingsScreen extends ConsumerWidget {
  const BookingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(bookingsFilterProvider);
    final async = ref.watch(bookingsProvider);
    return AppScaffold(
      title: 'Bookings',
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: FilterPills<String>(
              segments: const [
                Segment('upcoming', 'Upcoming'),
                Segment('unpaid', 'Money due'),
                Segment('past', 'Past'),
                Segment('completed', 'Completed'),
                Segment('cancelled', 'Cancelled'),
              ],
              selected: filter,
              onChanged: (v) => ref.read(bookingsFilterProvider.notifier).state = v,
            ),
          ),
        ),
        ...async.when(
          loading: () => [const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())))],
          error: (e, _) => [SliverToBoxAdapter(child: AsyncErrorView(title: "Couldn't load bookings", error: e, onRetry: () => ref.invalidate(bookingsProvider)))],
          data: (d) {
            final (rows, totals) = d;
            return [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(4, 0, 4, 12),
                  child: Text(
                    'Booked ${_rs(double.tryParse('${totals['booked_value']}'))} · Received ${_rs(double.tryParse('${totals['received']}'))} · Due ${_rs(double.tryParse('${totals['due']}'))}',
                    style: AppType.body(14, weight: FontWeight.w600),
                  ),
                ),
              ),
              if (rows.isEmpty)
                const SliverToBoxAdapter(
                  child: EmptyState(
                    icon: Icons.event_available_outlined,
                    title: 'No bookings here',
                    message: 'Confirm a request, or add bookings you take by phone on the website.',
                  ),
                )
              else
                SliverToBoxAdapter(
                  child: GroupedSection(children: [
                    for (final b in rows)
                      ListRow(
                        title: b.customer,
                        subtitle: [if (b.date != null) BsDate.format('EEE d MMM', b.date!), b.time, b.listing].join(' · '),
                        value: b.state == 'cancelled'
                            ? 'Cancelled'
                            : b.state == 'completed'
                                ? 'Done'
                                : {'paid': 'Paid', 'part_paid': 'Part paid'}[b.paymentState] ?? 'Unpaid',
                        chevron: true,
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => BookingDetailScreen(id: b.id, kind: b.kind))),
                      ),
                  ]),
                ),
            ];
          },
        ),
      ],
    );
  }
}

final _bookingProvider = FutureProvider.autoDispose.family<Booking, (String, String)>((ref, k) async {
  final resp = await ref.watch(_bookingsApi).get('/api/marketplace/my/bookings/${k.$2}/${k.$1}/');
  return Booking(Map<String, dynamic>.from(resp.data as Map));
});

class BookingDetailScreen extends ConsumerStatefulWidget {
  final String id;
  final String kind;
  const BookingDetailScreen({super.key, required this.id, required this.kind});

  @override
  ConsumerState<BookingDetailScreen> createState() => _BookingDetailScreenState();
}

class _BookingDetailScreenState extends ConsumerState<BookingDetailScreen> {
  bool _busy = false;

  Future<void> _run(Future<void> Function(ApiClient api, Booking b) action, Booking b, String done) async {
    setState(() => _busy = true);
    try {
      await action(ref.read(_bookingsApi), b);
      ref.invalidate(_bookingProvider((widget.id, widget.kind)));
      ref.invalidate(bookingsProvider);
      if (mounted) AppToast.success(context, done);
    } catch (e) {
      if (mounted) AppToast.error(context, friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addPayment(Booking b) async {
    final amount = TextEditingController();
    final note = TextEditingController();
    var method = 'cash';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Record a payment'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: amount, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Amount received (Rs)')),
            DropdownButtonFormField<String>(
              initialValue: method,
              decoration: const InputDecoration(labelText: 'How'),
              items: const [
                DropdownMenuItem(value: 'cash', child: Text('Cash')),
                DropdownMenuItem(value: 'bank', child: Text('Bank transfer')),
                DropdownMenuItem(value: 'wallet', child: Text('eSewa / Khalti (direct)')),
                DropdownMenuItem(value: 'cheque', child: Text('Cheque')),
                DropdownMenuItem(value: 'other', child: Text('Other')),
              ],
              onChanged: (v) => setLocal(() => method = v ?? 'cash'),
            ),
            TextField(controller: note, decoration: const InputDecoration(labelText: 'Note (optional)')),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Record')),
          ],
        ),
      ),
    );
    if (ok != true || (double.tryParse(amount.text.trim()) ?? 0) <= 0) return;
    await _run((api, b) => api.post('${b.path}payments/', data: {'amount': amount.text.trim(), 'method': method, 'note': note.text.trim()}), b, 'Payment recorded');
  }

  Future<void> _receipt(Booking b) async {
    try {
      final bytes = await ref.read(_bookingsApi).getBytes('${b.path}receipt/');
      await Printing.sharePdf(bytes: Uint8List.fromList(bytes), filename: 'receipt-${b.id.substring(0, 8)}.pdf');
    } catch (e) {
      if (mounted) AppToast.error(context, friendlyError(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(_bookingProvider((widget.id, widget.kind)));
    return AppScaffold(
      title: 'Booking',
      slivers: [
        ...async.when(
          loading: () => [const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())))],
          error: (e, _) => [SliverToBoxAdapter(child: AsyncErrorView(title: "Couldn't load the booking", error: e, onRetry: () => ref.invalidate(_bookingProvider((widget.id, widget.kind)))))],
          data: (b) {
            final active = b.state != 'cancelled';
            final today = DateTime.now();
            final canComplete = active && b.raw['completed_at'] == null && b.date != null && !b.date!.isAfter(DateTime(today.year, today.month, today.day));
            return [
              SliverToBoxAdapter(
                child: GroupedSection(header: b.customer, children: [
                  ListRow(title: 'Phone', value: b.phone.isEmpty ? '–' : b.phone),
                  ListRow(title: 'Date', value: b.date == null ? '–' : BsDate.format('EEE d MMM y', b.date!)),
                  ListRow(title: 'Time', value: b.time),
                  ListRow(title: 'Listing', value: [b.listing, if (b.space != null) b.space!].join(' · ')),
                ]),
              ),
              SliverToBoxAdapter(
                child: GroupedSection(header: 'Money', children: [
                  ListRow(title: 'Agreed', value: _rs(b.agreed)),
                  ListRow(title: 'Received', value: _rs(b.paid)),
                  ListRow(title: 'Due', value: b.balance == null ? '–' : _rs(b.balance! < 0 ? 0 : b.balance)),
                  for (final p in b.payments)
                    ListRow(
                      title: _rs(double.tryParse('${p['amount']}')),
                      subtitle: [p['method_label'], BsDate.format('d MMM y', DateTime.parse('${p['received_on']}')), if ('${p['note']}'.isNotEmpty) p['note']].join(' · '),
                    ),
                  if (active) ListRow(title: 'Record a payment', chevron: true, onTap: _busy ? null : () => _addPayment(b)),
                ]),
              ),
              SliverToBoxAdapter(
                child: GroupedSection(children: [
                  ListRow(title: 'Receipt (PDF)', chevron: true, onTap: () => _receipt(b)),
                  if (canComplete) ListRow(title: 'Mark completed', chevron: true, onTap: _busy ? null : () => _run((api, b) => api.post('${b.path}complete/'), b, 'Marked completed')),
                  if (active && b.raw['completed_at'] == null)
                    ListRow(
                      title: 'Cancel booking',
                      chevron: true,
                      onTap: _busy
                          ? null
                          : () async {
                              final yes = await showDialog<bool>(
                                context: context,
                                builder: (ctx) => AlertDialog(
                                  title: const Text('Cancel this booking?'),
                                  content: const Text('The slot opens again and the customer is emailed.'),
                                  actions: [
                                    TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')),
                                    FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Cancel booking')),
                                  ],
                                ),
                              );
                              if (yes == true) await _run((api, b) => api.post('${b.path}cancel/'), b, 'Booking cancelled');
                            },
                    ),
                ]),
              ),
            ];
          },
        ),
      ],
    );
  }
}
