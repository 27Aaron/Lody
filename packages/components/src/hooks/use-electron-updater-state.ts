import { useEffect, useState } from 'react';
import type { ElectronUpdaterState } from '@lody/shared';

export function useElectronUpdaterState(): ElectronUpdaterState | null {
  const [state, setState] = useState<ElectronUpdaterState | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.__LODY_ELECTRON__) return undefined;

    const updater = window.api?.updater;
    if (
      !updater ||
      typeof updater.getState !== 'function' ||
      typeof updater.onState !== 'function'
    ) {
      return undefined;
    }

    let active = true;
    void updater
      .getState()
      .then((s) => {
        if (active) setState(s);
      })
      .catch(() => {
        // Ignore updater read errors in renderer; main process tracks failures.
      });

    const unsubscribe = updater.onState((s) => {
      if (active) setState(s);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return state;
}
