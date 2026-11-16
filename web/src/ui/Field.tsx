import { useId } from "react";

export interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  type?: "text" | "search";
}

/**
 * Rotulo e entrada de texto. O `id` liga os dois: sem ele, o `useId` gera um
 * estavel por instancia, entao o `<label htmlFor>` sempre acha o `<input>`.
 */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
  id,
  type = "text",
}: FieldProps) {
  const gerado = useId();
  const inputId = id ?? gerado;

  return (
    <div className="dy-field">
      <label className="dy-field__label dy-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        className="dy-field__input dy-body"
        id={inputId}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
