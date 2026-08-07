import type { RepoRoomSubscription, RepoTransportRoomStatus } from 'loro-repo';

/** The single cloud transport id the CLI repo routes every room to. */
export const STREAMS_TRANSPORT_ID = 'streams';

/**
 * Detached-aware view of one room's Streams membership.
 *
 * Every detached-sensitive read (status skip-lists, recovery gating,
 * first-sync waits) must go through this instead of the classic single-value
 * `TransportSubscription` surface, which hides 'detached': it maps a detached
 * binding to 'disconnected', so recovery would read deliberate absence as a
 * failure and spin on it. The classic `waitUntilSynced()` additionally THROWS
 * on a room with no routed transports (zero-transport offline startup), while
 * `firstSyncedWithRemote` there is equivalent to the binding's (both are a
 * pending resolve-only deferred), so routing it through the binding is
 * uniformity rather than a fix — but `status`/`onStatusChange` are NOT
 * equivalent, since the classic surface reports a pending room as
 * 'disconnected'.
 */
export type StreamsRoomBinding = {
  readonly status: RepoTransportRoomStatus;
  readonly onStatusChange: (listener: (status: RepoTransportRoomStatus) => void) => () => void;
  readonly firstSyncedWithRemote: Promise<void>;
  readonly waitUntilSynced: () => Promise<void>;
};

/**
 * Selects the stable per-transport 'streams' binding of a room subscription.
 *
 * The binding handle survives `removeTransport`/`addTransport` cycles: it
 * reports 'detached' truthfully while the transport is absent and resumes live
 * status (and settles `firstSyncedWithRemote`) once the transport re-attaches,
 * so it can be captured once at join time. While 'streams' is attached the
 * binding status equals the classic status, so online behavior is unchanged.
 *
 * Takes `RepoRoomSubscription` deliberately: an earlier version accepted the
 * classic `TransportSubscription` and fell back to it when `subscription()`
 * was absent, which meant every test fake silently exercised the classic path
 * this helper exists to avoid — the bug would have survived its own tests.
 */
export function streamsRoomBinding(sub: RepoRoomSubscription): StreamsRoomBinding {
  const binding = sub.subscription(STREAMS_TRANSPORT_ID);
  return {
    get status() {
      return binding.status;
    },
    onStatusChange: (listener) => binding.onStatusChange(listener),
    get firstSyncedWithRemote() {
      return binding.firstSyncedWithRemote;
    },
    waitUntilSynced: () => binding.waitUntilSynced(),
  };
}
