import type { LocalLoroDataPlaneConnection } from '@lody/shared';

/** Bridges Electron's preload push API to the local Loro transport. */
export function createLocalLoroDataPlaneConnection(): {
  connection: LocalLoroDataPlaneConnection;
  dispose: () => void;
} | null {
  const api = window.api?.loroDataPlane;
  if (!api) return null;

  let connected = false;
  const statusListeners = new Set<(connected: boolean) => void>();
  const setConnected = (next: boolean) => {
    if (connected === next) return;
    connected = next;
    for (const listener of statusListeners) listener(next);
  };
  api.subscribe();
  const unsubscribeStatus = api.onStatus(setConnected);
  void api.isConnected().then(setConnected);

  return {
    connection: {
      send: (message) => api.send(message),
      onMessage: (listener) => api.onEvent(listener),
      onStatusChange: (listener) => {
        statusListeners.add(listener);
        listener(connected);
        return () => statusListeners.delete(listener);
      },
      isConnected: () => connected,
    },
    dispose: () => {
      unsubscribeStatus();
      statusListeners.clear();
    },
  };
}
