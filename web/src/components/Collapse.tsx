import { useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/** Per-browser UI memory (open/closed panels, filters, theme). The page works fine without it. */
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  // Functional updates so rapid clicks build on the latest state instead of a stale copy.
  const update = (next: T | ((prev: T) => T)) =>
    setValue((prev) => {
      const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
      return v;
    });
  return [value, update] as const;
}

/** Remembered collapsed flag for one panel. */
export function useCollapsed(key: string, initial = false) {
  const [collapsed, setCollapsed] = useStored<boolean>(`collapsed:${key}`, initial);
  return [collapsed, () => setCollapsed((c) => !c)] as const;
}

export function CollapseButton({ collapsed, onToggle, label, controls }: {
  collapsed: boolean; onToggle: () => void; label: string; controls?: string;
}) {
  return (
    <button type="button" className={`collapse-btn ${collapsed ? '' : 'open'}`} onClick={onToggle}
      aria-expanded={!collapsed} aria-controls={controls} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}>
      <Icon name="chevron" size={18} />
    </button>
  );
}

/** A titled section inside a Car / Charger / Solar card that can be collapsed. */
export function Section({ title, id, scope, children }: { title: string; id?: string; scope: string; children: ReactNode }) {
  const [collapsed, toggle] = useCollapsed(`${scope}:${id ?? title}`);
  const bodyId = useId();
  return (
    <section className={`v-section ${collapsed ? 'collapsed' : ''}`}>
      <h3>
        <button type="button" className="section-toggle" onClick={toggle} aria-expanded={!collapsed} aria-controls={bodyId}>
          <span>{title}</span>
          <span className={`chevron ${collapsed ? '' : 'open'}`}><Icon name="chevron" size={16} /></span>
        </button>
      </h3>
      {!collapsed && <div id={bodyId} className="v-section-body">{children}</div>}
    </section>
  );
}
