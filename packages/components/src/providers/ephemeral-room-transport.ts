import {
  EphemeralStoreAdaptor,
  EphemeralStreamCrdt,
  type EphemeralStreamSubscription,
} from '@loro-dev/streams-crdt/loro';
import type { EphemeralStore } from 'loro-crdt';
import {
  LORO_STREAMS_BUCKET_ID,
  createLoroStreamUrl,
  getLoroMetaStreamId,
  getLoroStreamsPresenceBaseUrl,
  pickLoroStreamsPresenceShardId,
  type LoroStreamsPresenceShardId,
  type WorkspaceId,
} from '@lody/shared';
import type { RoomSyncState } from '@/lib/room-sync-state';

export type EphemeralRoomAuthCallback = (context?: {
  reason: string;
}) => Promise<string | undefined>;

export type EphemeralRoomStoreLike = {
  getAllStates(): Record<string, unknown>;
  subscribe(listener: () => void): () => void;
  destroy(): void;
};

export type EphemeralRoomTransportLike = {
  join(
    options: Parameters<EphemeralStreamCrdt['join']>[0]
  ): ReturnType<EphemeralStreamCrdt['join']>;
  close(): Promise<void>;
};

/**
 * Combined status emitted by `EphemeralStreamCrdt` subscriptions. Mapped onto
 * {@link RoomSyncState} so ephemeral rooms can live in the same room-sync
 * registry as durable rooms ('joined' means bootstrap applied, hence 'synced').
 */
export const EPHEMERAL_STATUS_TO_SYNC_STATE: Record<string, RoomSyncState> = {
  connecting: 'connecting',
  joined: 'synced',
  reconnecting: 'reconnecting',
  disconnected: 'disconnected',
  error: 'error',
};

export type EphemeralRoomBaseOptions = {
  workspaceId: WorkspaceId;
  /**
   * Presence subdomain shard for this tab. Defaults to a random shard so multiple
   * tabs spread across hosts and don't exhaust the browser's per-host connection
   * limit. Pass a fixed id in tests for deterministic URLs.
   */
  presenceShardId?: LoroStreamsPresenceShardId;
  onWarning?: (message: string, context?: Record<string, unknown>) => void;
};

/**
 * Shared lifecycle for a Loro Streams ephemeral room: generation-gated
 * connect/reconnect, status → {@link RoomSyncState} mapping, and bounded
 * teardown. Presence and machine-monitor transports extend this and supply
 * only their per-room specifics (stream-url tag, store, snapshot delivery).
 *
 * The ephemeral read loop terminates on non-retriable errors (e.g. 401 after a
 * long sleep) instead of retrying, so 'error'/'disconnected' here mean "dead
 * until externally restarted" — the workspace reconnect loop watches
 * {@link getSyncState}/{@link needsReconnect} and restarts the transport.
 */
export abstract class EphemeralRoomTransport<
  TStore extends EphemeralRoomStoreLike,
  TOptions extends EphemeralRoomBaseOptions,
> {
  protected store: TStore | null = null;
  protected transport: EphemeralRoomTransportLike | null = null;
  private subscription: EphemeralStreamSubscription | null = null;
  private detachStoreListener: (() => void) | null = null;
  protected generation = 0;
  protected streamUrl: string | null = null;
  protected readonly presenceShardId: LoroStreamsPresenceShardId;
  private syncState: RoomSyncState = 'idle';
  private readonly syncStateListeners = new Set<(state: RoomSyncState) => void>();

  constructor(protected readonly options: TOptions) {
    this.presenceShardId = options.presenceShardId ?? pickLoroStreamsPresenceShardId();
  }

  getSyncState(): RoomSyncState {
    return this.syncState;
  }

  subscribeSyncState(listener: (state: RoomSyncState) => void): () => void {
    this.syncStateListeners.add(listener);
    listener(this.syncState);
    return () => {
      this.syncStateListeners.delete(listener);
    };
  }

  needsReconnect(): boolean {
    return this.syncState === 'error' || this.syncState === 'disconnected';
  }

  abstract shouldRestartOnExternalWake(nowMs?: number): boolean;

  start(args: { baseUrl: string; auth: EphemeralRoomAuthCallback }): void {
    void this.teardownResources(`failed to close previous ${this.roomLabel}`);
    const generation = (this.generation += 1);
    const durableStreamUrl = createLoroStreamUrl({
      bucketId: LORO_STREAMS_BUCKET_ID,
      streamId: getLoroMetaStreamId(this.options.workspaceId),
      baseUrl: getLoroStreamsPresenceBaseUrl(args.baseUrl, this.presenceShardId),
    });
    const store = this.createStore();
    const streamUrl = this.tagStreamUrl(durableStreamUrl);
    const transport = this.createTransport({ streamUrl, auth: args.auth, store });
    this.store = store;
    this.transport = transport;
    this.streamUrl = streamUrl;
    this.detachStoreListener = store.subscribe(() => this.onStoreChange(store));
    this.setSyncState('connecting');
    this.onRoomStarted(store);

    void transport
      .join({
        onStatusChange: (status) => {
          if (generation !== this.generation) return;
          this.setSyncState(EPHEMERAL_STATUS_TO_SYNC_STATE[status] ?? 'connecting');
          if (status === 'joined') this.onJoined(store);
        },
      })
      .then((result) => {
        if (generation !== this.generation) {
          if (result.ok) result.value.unsubscribe();
          return;
        }
        if (result.ok) {
          this.subscription = result.value;
          return;
        }
        this.setSyncState('error');
        this.warn(`failed to join ${this.roomLabel}`, { error: result.error });
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return;
        this.setSyncState('error');
        this.warn(`failed to start ${this.roomLabel}`, { error });
      });
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.setSyncState('idle');
    this.onBeforeStop();
    await this.teardownResources(`failed to close ${this.roomLabel}`);
  }

  protected setSyncState(next: RoomSyncState): void {
    if (this.syncState === next) return;
    this.syncState = next;
    for (const listener of Array.from(this.syncStateListeners)) {
      listener(next);
    }
  }

  protected async teardownResources(closeErrorMessage: string): Promise<void> {
    this.onBeforeTeardown();
    this.detachStoreListener?.();
    this.detachStoreListener = null;
    this.subscription?.unsubscribe();
    this.subscription = null;
    const store = this.store;
    const transport = this.transport;
    this.store = null;
    this.transport = null;
    this.streamUrl = null;
    if (transport) {
      try {
        await transport.close();
      } catch (error) {
        this.warn(closeErrorMessage, { error });
      }
    }
    store?.destroy();
  }

  protected warn(message: string, context?: Record<string, unknown>): void {
    this.options.onWarning?.(`${this.warnPrefix}: ${message}`, context);
  }

  protected createTransport(args: {
    streamUrl: string;
    auth: EphemeralRoomAuthCallback;
    store: TStore;
  }): EphemeralRoomTransportLike {
    return new EphemeralStreamCrdt({
      streamUrl: args.streamUrl,
      auth: args.auth,
      adaptor: EphemeralStoreAdaptor(args.store as unknown as EphemeralStore),
    });
  }

  /** Log prefix for {@link warn} (kept per-subclass to preserve existing log lines). */
  protected abstract readonly warnPrefix: string;
  /** Human label for this room, used in join/close warning messages. */
  protected abstract readonly roomLabel: string;
  /** Build the room's ephemeral store (subclass owns the TTL and test injection). */
  protected abstract createStore(): TStore;
  /** Tag the durable meta stream URL with the room's ephemeral channel. */
  protected abstract tagStreamUrl(durableStreamUrl: string): string;
  /** React to a store mutation (deliver a fresh snapshot to consumers). */
  protected abstract onStoreChange(store: TStore): void;
  /** Extra setup once the store+transport are wired and sync state is 'connecting'. */
  protected onRoomStarted(_store: TStore): void {}
  /** Runs when the room reaches 'joined'; defaults to delivering a snapshot. */
  protected onJoined(store: TStore): void {
    this.onStoreChange(store);
  }
  /** Synchronous extras before store/transport are torn down (this.store still set). */
  protected onBeforeTeardown(): void {}
  /** Synchronous extras at the start of {@link stop}, before teardown. */
  protected onBeforeStop(): void {}
}
