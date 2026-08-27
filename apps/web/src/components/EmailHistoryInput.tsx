import { useState } from "react";
import { X } from "lucide-react";
import { Dropdown, DropdownAnchor, DropdownContent, Input, type InputProps } from "./ui/index.js";

interface EmailHistoryInputProps extends Omit<InputProps, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  emails: string[];
  onRemoveEmail: (email: string) => void;
}

/** An email input that, on focus, offers previously-used addresses (saved by
 * the caller via `useEmailHistory`) in a dropdown below it -- each with its
 * own remove button, so a list of test addresses can be pruned over time. */
export default function EmailHistoryInput({
  value,
  onChange,
  emails,
  onRemoveEmail,
  ...props
}: EmailHistoryInputProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dropdown open={open && emails.length > 0} onOpenChange={setOpen}>
      <DropdownAnchor asChild>
        <Input
          {...props}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (emails.length === 0) return;
            // Deferred to the next frame: opening synchronously inside the
            // focus event of a click lets Radix's dismissable layer treat
            // that same click's completion as an outside interaction and
            // close the popover immediately after it opens.
            requestAnimationFrame(() => setOpen(true));
          }}
        />
      </DropdownAnchor>
      <DropdownContent
        align="start"
        size="auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="max-h-60 w-64 overflow-y-auto p-1"
      >
        {emails.map((email) => (
          <div
            key={email}
            className="hover:bg-accent hover:text-accent-foreground group flex items-center rounded-sm"
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
              onClick={() => {
                onChange(email);
                setOpen(false);
              }}
            >
              {email}
            </button>
            <button
              type="button"
              aria-label={`Remove ${email}`}
              className="text-muted-foreground hover:text-destructive mr-1 shrink-0 rounded-sm p-1 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveEmail(email);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}
