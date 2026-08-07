import { useEffect, useState } from 'react';

/**
 * Returns a `Date` that updates at most once per `intervalMs` (default 60 s).
 *
 * Using this hook instead of bare `new Date()` at render time avoids
 * unnecessary recalculation of relative-time labels on every re-render
 * and keeps the reference stable between intervals, which helps
 * downstream `useMemo` / `React.memo` bail out.
 */
export function useStableNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
