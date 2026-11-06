import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/storage.dart';
import '../../payments/payment_api.dart';
import '../../providers/auth_provider.dart';
import '../data/contest_api.dart';
import '../models/contest.dart';
import '../models/stored_pass.dart';
import 'pass_providers.dart';

final contestApiProvider = Provider<ContestApi>((ref) => ContestApi());
final paymentApiProvider = Provider<PaymentApi>((ref) => PaymentApi());

typedef ContestKey = ({String slug, String ref});
typedef ContestantKey = ({String slug, String ref, String cref});

/// A contest with its contestants (refetched by the screens every few seconds while open).
final contestProvider = FutureProvider.autoDispose.family<Contest, ContestKey>((ref, k) {
  return ref.watch(contestApiProvider).contest(k.slug, k.ref);
});

/// One contestant's profile with the contest around it.
final contestantProvider =
    FutureProvider.autoDispose.family<({Contest contest, Contestant contestant}), ContestantKey>((ref, k) {
  return ref.watch(contestApiProvider).contestant(k.slug, k.ref, k.cref);
});

/// Who would vote right now without asking anything: the device (open contests), the signed-in
/// account (account / ticket contests), a pass saved on this phone (ticket contests) or a code
/// verified earlier (SMS / email contests). Null when the voter still has to identify.
Future<VoterIdentity?> readyIdentity(Contest c, {StoredPass? pass, required bool signedIn}) async {
  final device = await AppStorage.getDeviceId();
  switch (c.voteMode) {
    case 'sms_otp':
    case 'email_otp':
      final t = await VoterStore.token(c.id);
      return t == null ? null : VoterIdentity(voterToken: t.token, deviceId: device);
    case 'ticket':
      if (pass != null) return VoterIdentity(ticketCode: pass.qrToken, deviceId: device);
      return signedIn ? VoterIdentity(deviceId: device) : null;
    case 'account':
      return signedIn ? VoterIdentity(deviceId: device) : null;
    case 'contact':
      return null; // typed each time (checked on submit)
    default:
      return VoterIdentity(deviceId: device);
  }
}

/// Remaining votes for this phone's voter in a contest, when known without asking (see [readyIdentity]).
final myAllowanceProvider = FutureProvider.autoDispose.family<AllowanceSet?, Contest>((ref, c) async {
  final signedIn = ref.watch(authProvider.select((s) => s.user != null));
  final pass = ref.watch(passForEventProvider(c.eventSlug));
  if (!c.acceptingVotes) return null;
  final id = await readyIdentity(c, pass: pass, signedIn: signedIn);
  if (id == null) return null;
  try {
    return await ref.watch(contestApiProvider).allowance(c.eventSlug, c.ref, id);
  } on ContestFailure {
    return null;
  }
});
