import { useState } from "react";

const UNITS = [
  { label: "seconds", mult: 1 },
  { label: "minutes", mult: 60 },
  { label: "hours", mult: 3600 },
] as const;

function pickUnitMult(seconds: number): number {
  if (seconds > 0 && seconds % 3600 === 0) return 3600;
  if (seconds > 0 && seconds % 60 === 0) return 60;
  return 1;
}

interface DurationInputProps {
  /** Total seconds, or null/undefined for "unset". */
  seconds: number | null | undefined;
  onChange: (seconds: number | null) => void;
  placeholder?: string;
}

/**
 * A number input + unit (seconds/minutes/hours) dropdown that together edit
 * a single total-seconds value. Initializes its displayed unit from the
 * incoming value (e.g. 900 shows as "15 minutes"), then edits independently
 * of further prop changes -- key this component by record id so switching
 * between records (e.g. add vs. edit, or editing a different row) remounts
 * it with a fresh initial value instead of fighting the user's typing.
 */
export default function DurationInput({ seconds, onChange, placeholder }: DurationInputProps) {
  const initialMult = seconds ? pickUnitMult(seconds) : 60;
  const [unitMult, setUnitMult] = useState(initialMult);
  const [valueStr, setValueStr] = useState(seconds ? String(seconds / initialMult) : "");

  function emit(nextValueStr: string, nextUnitMult: number) {
    const n = Number(nextValueStr);
    onChange(nextValueStr !== "" && n > 0 ? Math.round(n * nextUnitMult) : null);
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        type="number"
        min={1}
        value={valueStr}
        placeholder={placeholder}
        onChange={(e) => {
          setValueStr(e.target.value);
          emit(e.target.value, unitMult);
        }}
        style={{ flex: 1 }}
      />
      <select
        value={unitMult}
        onChange={(e) => {
          const next = Number(e.target.value);
          setUnitMult(next);
          emit(valueStr, next);
        }}
        style={{ width: "auto" }}
      >
        {UNITS.map((u) => (
          <option key={u.label} value={u.mult}>
            {u.label}
          </option>
        ))}
      </select>
    </div>
  );
}
