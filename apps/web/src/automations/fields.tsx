import { X } from "lucide-react";
import { useAutomationData } from "./context.js";
import {
  Button,
  Checkbox,
  CheckboxLabel,
  FormLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/index.js";

interface ListPickerProps {
  label: string;
  value: number[];
  onChange: (listIds: number[]) => void;
  /** Copy shown when nothing is ticked -- differs between a trigger ("any
   * list") and an action ("pick at least one"). */
  emptyHint: string;
}

export function ListPicker({ label, value, onChange, emptyHint }: ListPickerProps) {
  const { lists } = useAutomationData();

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div className="space-y-2">
      <FormLabel>{label}</FormLabel>
      <div className="space-y-2 rounded-md border p-3">
        {lists.map((list) => (
          <div key={list.id} className="flex items-center gap-2">
            <Checkbox
              id={`list-${list.id}`}
              checked={value.includes(list.id)}
              onCheckedChange={() => toggle(list.id)}
            />
            <CheckboxLabel htmlFor={`list-${list.id}`}>
              {list.name}
              <span className="text-muted-foreground ml-2 text-xs">
                {list.type} · {list.optin} opt-in
              </span>
            </CheckboxLabel>
          </div>
        ))}
        {lists.length === 0 && (
          <p className="text-muted-foreground text-sm">No lists yet — create one first.</p>
        )}
      </div>
      {value.length === 0 && <p className="text-muted-foreground text-xs">{emptyHint}</p>}
    </div>
  );
}

interface ConnectionChainPickerProps {
  connectionId: number | undefined;
  fallbackIds: number[];
  onChange: (next: {
    connection_id: number | undefined;
    fallback_connection_ids: number[];
  }) => void;
}

/** Mirrors the campaign connection picker: one primary plus ordered fallbacks.
 * There is deliberately no "any enabled connection" option — the API refuses
 * to send without an explicit choice (see services/connections.ts). */
export function ConnectionChainPicker({
  connectionId,
  fallbackIds,
  onChange,
}: ConnectionChainPickerProps) {
  const { connections } = useAutomationData();
  const available = connections.filter((c) => c.id !== connectionId && !fallbackIds.includes(c.id));

  return (
    <div className="space-y-2">
      <FormLabel required>Sending connection</FormLabel>
      <Select
        value={connectionId ? String(connectionId) : ""}
        onValueChange={(v) =>
          onChange({
            connection_id: Number(v),
            fallback_connection_ids: fallbackIds.filter((id) => id !== Number(v)),
          })
        }
      >
        <SelectTrigger>
          <SelectValue placeholder="Choose a connection…" />
        </SelectTrigger>
        <SelectContent>
          {connections.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.name} — {c.from_email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <FormLabel>
        Fallbacks <span className="text-muted-foreground text-xs">(tried in order)</span>
      </FormLabel>
      {fallbackIds.length > 0 && (
        <ol className="list-decimal space-y-1 pl-5">
          {fallbackIds.map((id) => {
            const connection = connections.find((c) => c.id === id);
            return (
              <li key={id} className="text-sm">
                <span className="mr-2">{connection ? connection.name : `#${id}`}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onChange({
                      connection_id: connectionId,
                      fallback_connection_ids: fallbackIds.filter((f) => f !== id),
                    })
                  }
                >
                  <X className="h-3 w-3" />
                </Button>
              </li>
            );
          })}
        </ol>
      )}
      {available.length > 0 && (
        <Select
          value=""
          onValueChange={(v) =>
            onChange({
              connection_id: connectionId,
              fallback_connection_ids: [...fallbackIds, Number(v)],
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Add a fallback…" />
          </SelectTrigger>
          <SelectContent>
            {available.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name} — {c.from_email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
