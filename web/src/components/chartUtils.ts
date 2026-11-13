// Shared helpers for the hand-drawn SVG charts.
import { useLayoutEffect, useRef, useState } from 'react';

/** Width of a chart's container, measured before paint and kept up to date. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(320);
  // Measure before paint so the chart never renders wider than its container.
  useLayoutEffect(() => {
    if (!ref.current) return;
    setWidth(Math.max(240, ref.current.clientWidth));
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((m) => m >= v)!;
}
