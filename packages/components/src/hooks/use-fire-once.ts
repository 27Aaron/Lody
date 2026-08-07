import { useCallback, useRef } from 'react';

/**
 * Guards for de-duplicating analytics (or other "fire-once") effects, so each
 * call site doesn't hand-roll its own `useRef` bookkeeping.
 *
 * Two distinct semantics are intentionally kept separate because they are NOT
 * interchangeable:
 * - `useFireOncePerKey`: a key fires at most once for the lifetime of the
 *   component. Revisiting a previously seen key (A → B → A) does NOT re-fire.
 * - `useFireOnKeyChange`: fires whenever the key differs from the previous one.
 *   Revisiting (A → B → A) DOES re-fire A, while consecutive duplicates are
 *   suppressed. Use this when re-selecting the same value is a meaningful event.
 */

/** Returns `shouldFire(key)` → true only the first time each distinct key is seen. */
export function useFireOncePerKey<K = string>(): (key: K) => boolean {
  const seenRef = useRef<Set<K>>(new Set());
  return useCallback((key: K) => {
    if (seenRef.current.has(key)) {
      return false;
    }
    seenRef.current.add(key);
    return true;
  }, []);
}

/** Returns `shouldFire(key)` → true whenever the key changes from the previous call. */
export function useFireOnKeyChange<K = string>(): (key: K) => boolean {
  const previousRef = useRef<K | null>(null);
  return useCallback((key: K) => {
    if (previousRef.current === key) {
      return false;
    }
    previousRef.current = key;
    return true;
  }, []);
}
