import { useState } from "react";
import {
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectItem,
  SelectContent,
} from "./ui/index.js";

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
  seconds: number | null | undefined;
  onChange: (seconds: number | null) => void;
  placeholder?: string;
}

export default function DurationInput({ seconds, onChange, placeholder }: DurationInputProps) {
  const initialMult = seconds ? pickUnitMult(seconds) : 60;
  const [unitMult, setUnitMult] = useState(initialMult);
  const [valueStr, setValueStr] = useState(seconds ? String(seconds / initialMult) : "");

  function emit(nextValueStr: string, nextUnitMult: number) {
    const n = Number(nextValueStr);
    onChange(nextValueStr !== "" && n > 0 ? Math.round(n * nextUnitMult) : null);
  }

  const unitValue = String(unitMult);

  return (
    <div className="flex gap-2">
      <Input
        type="number"
        min={1}
        value={valueStr}
        placeholder={placeholder}
        onChange={(e) => {
          setValueStr(e.target.value);
          emit(e.target.value, unitMult);
        }}
        className="flex-1"
      />
      <Select
        value={unitValue}
        onValueChange={(v) => {
          const next = Number(v);
          setUnitMult(next);
          emit(valueStr, next);
        }}
      >
        <SelectTrigger width="auto" className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UNITS.map((u) => (
            <SelectItem key={u.label} value={String(u.mult)}>
              {u.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
