export function Toggle({ on, disabled, onChange, label }: {
  on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      className={`toggle ${on ? 'on' : ''}`}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}>
      <span />
    </button>
  );
}
