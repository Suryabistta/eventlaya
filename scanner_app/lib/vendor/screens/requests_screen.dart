import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../ui/ui.dart';
import '../data/vendor_api.dart';
import '../data/vendor_models.dart';
import '../providers/vendor_providers.dart';
import '../widgets/request_sheet.dart';
import '../widgets/vendor_widgets.dart';

enum _Filter { all, pending, booked, declined, cancelled }

/// Venue and service requests in one inbox.
class RequestsScreen extends ConsumerStatefulWidget {
  const RequestsScreen({super.key});

  @override
  ConsumerState<RequestsScreen> createState() => _RequestsScreenState();
}

class _RequestsScreenState extends ConsumerState<RequestsScreen> {
  _Filter _filter = _Filter.all;
  bool _bookingsOnly = false;

  bool _matches(BookingRequest r, _Filter f) => switch (f) {
        _Filter.all => true,
        _Filter.pending => r.isOpen,
        _Filter.booked => r.status == RequestStatus.booked,
        _Filter.declined => r.status == RequestStatus.rejected,
        _Filter.cancelled => r.status == RequestStatus.cancelled,
      };

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(vendorRequestsProvider);
    final all = async.valueOrNull;
    final base = (all ?? const <BookingRequest>[]).where((r) => !_bookingsOnly || r.isBooking).toList();
    int count(_Filter f) => base.where((r) => _matches(r, f)).length;
    final visible = base.where((r) => _matches(r, _filter)).toList();
    // Waiting requests first in "All", oldest waiting first so nothing is forgotten.
    if (_filter == _Filter.all) {
      visible.sort((a, b) {
        if (a.isOpen != b.isOpen) return a.isOpen ? -1 : 1;
        return (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0));
      });
    }

    return AppScaffold(
      title: 'Requests',
      automaticBack: false,
      onRefresh: () async {
        ref.invalidate(vendorRequestsProvider);
        try {
          await ref.read(vendorRequestsProvider.future);
        } catch (_) {}
      },
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: FilterPills<_Filter>(
              segments: [
                Segment(_Filter.all, 'All', count: all == null ? null : count(_Filter.all)),
                Segment(_Filter.pending, 'Pending', count: all == null ? null : count(_Filter.pending)),
                Segment(_Filter.booked, 'Booked', count: all == null ? null : count(_Filter.booked)),
                Segment(_Filter.declined, 'Declined', count: all == null ? null : count(_Filter.declined)),
                Segment(_Filter.cancelled, 'Cancelled', count: all == null ? null : count(_Filter.cancelled)),
              ],
              selected: _filter,
              onChanged: (f) => setState(() => _filter = f),
            ),
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(children: [
              Expanded(
                child: Text(
                  _bookingsOnly ? 'Only requests for a calendar slot' : 'Slot bookings and general inquiries',
                  style: AppType.caption,
                ),
              ),
              Text('Bookings only', style: AppType.body(13.5, weight: FontWeight.w500)),
              const SizedBox(width: 4),
              Switch.adaptive(
                value: _bookingsOnly,
                activeTrackColor: AppColors.brand,
                onChanged: (v) => setState(() => _bookingsOnly = v),
              ),
            ]),
          ),
        ),
        if (all == null && async.hasError)
          SliverFillRemaining(
            hasScrollBody: false,
            child: ErrorState(
              message: vendorErrorMessage(async.error!),
              onRetry: () => ref.invalidate(vendorRequestsProvider),
            ),
          )
        else if (all == null)
          const SliverToBoxAdapter(child: LoadingList(rows: 4))
        else if (visible.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.inbox_outlined,
              title: switch (_filter) {
                _Filter.pending => 'Nothing waiting',
                _Filter.booked => 'No bookings yet',
                _Filter.declined => 'Nothing declined',
                _Filter.cancelled => 'No cancellations',
                _ => 'No requests yet',
              },
              message: _filter == _Filter.all
                  ? 'When customers ask about your listing or request a slot, it shows up here.'
                  : 'Requests with this status show up here.',
            ),
          )
        else
          SliverList.builder(
            itemCount: visible.length,
            itemBuilder: (context, i) => RequestCard(
              request: visible[i],
              onTap: () => showRequestDetail(context, visible[i]),
            ),
          ),
      ],
    );
  }
}
