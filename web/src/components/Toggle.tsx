interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  ariaLabel?: string;
}

// Toggle is an Apple-style switch.
export function Toggle({ checked, onChange, label, ariaLabel }: ToggleProps) {
  return (
    <label className={checked ? "toggle toggle--on" : "toggle"}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={ariaLabel ?? label}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob" />
      </span>
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}

export default Toggle;
