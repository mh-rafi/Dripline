import { useState } from "react";
import { Braces, Check, Copy } from "lucide-react";
import {
  Button,
  Dropdown,
  DropdownContent,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  toast,
} from "../ui/index.js";

/**
 * Merge fields ({{ Mustache }} placeholders) offered by the editor toolbar.
 * The authoritative list is `TemplateContext` in
 * `apps/api/src/lib/template.ts` -- anything added there needs an entry here
 * too, or authors have no way to discover it. `{{ Body }}` is the exception:
 * it is a literal string replace in `services/mailer.ts`, not a Mustache key,
 * so it must be copied with exactly that spacing.
 */

/** Where the body being edited will be rendered. Decides which merge fields
 * actually resolve at send time: a campaign body has no `Automation`, an
 * automation email has no `Campaign`, and `{{ Body }}` only means anything
 * inside a template wrapper. */
export type MergeFieldScope = "campaign" | "automation" | "template";

interface MergeField {
  tag: string;
  label: string;
  example: string;
}

interface MergeFieldGroup {
  group: string;
  fields: MergeField[];
}

const CONTACT: MergeFieldGroup = {
  group: "Contact",
  fields: [
    { tag: "{{ Subscriber.Name }}", label: "Name", example: "Ada Lovelace" },
    { tag: "{{ Subscriber.Email }}", label: "Email", example: "ada@example.com" },
    { tag: "{{ Subscriber.ID }}", label: "Contact ID", example: "42" },
    { tag: "{{ Subscriber.UUID }}", label: "Contact UUID", example: "3f2a…" },
    {
      tag: "{{ Subscriber.Attribs.plan }}",
      label: "Custom attribute",
      example: "any key from the contact's attributes",
    },
  ],
};

const LINKS: MergeFieldGroup = {
  group: "Links",
  fields: [
    {
      tag: "{{ UnsubscribeURL }}",
      label: "Unsubscribe link",
      example: "required in every marketing email",
    },
  ],
};

const GROUPS: Record<MergeFieldScope, MergeFieldGroup[]> = {
  campaign: [
    CONTACT,
    {
      group: "Campaign",
      fields: [
        { tag: "{{ Campaign.Name }}", label: "Campaign name", example: "March newsletter" },
        { tag: "{{ Campaign.Subject }}", label: "Subject line", example: "What's new in March" },
        { tag: "{{ Campaign.UUID }}", label: "Campaign UUID", example: "9c1e…" },
      ],
    },
    LINKS,
  ],
  automation: [
    CONTACT,
    {
      group: "Automation",
      fields: [
        { tag: "{{ Automation.Name }}", label: "Automation name", example: "Welcome sequence" },
        { tag: "{{ Automation.UUID }}", label: "Automation UUID", example: "7b40…" },
      ],
    },
    LINKS,
  ],
  template: [
    {
      group: "Template",
      fields: [
        {
          tag: "{{ Body }}",
          label: "Campaign body",
          example: "where the campaign's own content is injected",
        },
      ],
    },
    CONTACT,
    LINKS,
  ],
};

/** Clipboard API needs a secure context -- a self-hosted install served over
 * plain http on a LAN address doesn't get one, so fall back to the old
 * execCommand path rather than failing silently there. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

interface MergeFieldPickerProps {
  scope?: MergeFieldScope;
}

export default function MergeFieldPicker({ scope = "campaign" }: MergeFieldPickerProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(field: MergeField) {
    const ok = await copyText(field.tag);
    if (!ok) {
      toast.error("Couldn't copy — select the tag and copy it manually", {
        description: field.tag,
      });
      return;
    }
    setCopied(field.tag);
    setTimeout(() => setCopied(null), 1500);
    toast.success(`Copied ${field.tag}`, { description: "Paste it anywhere in the body." });
    setOpen(false);
  }

  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Braces className="h-4 w-4" />
          Merge fields
        </Button>
      </DropdownTrigger>
      <DropdownContent align="end" size="lg" className="max-h-[22rem] overflow-y-auto p-1">
        <DropdownLabel>Click a field to copy it</DropdownLabel>
        {GROUPS[scope].map((group, index) => (
          <div key={group.group}>
            {index > 0 && <DropdownSeparator />}
            <DropdownLabel className="text-muted-foreground text-xs">{group.group}</DropdownLabel>
            {group.fields.map((field) => (
              <button
                key={field.tag}
                type="button"
                onClick={() => copy(field)}
                className="hover:bg-accent hover:text-accent-foreground flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left transition"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs">{field.tag}</span>
                  <span className="text-muted-foreground block text-xs">
                    {field.label} — {field.example}
                  </span>
                </span>
                {copied === field.tag ? (
                  <Check className="text-success mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Copy className="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
              </button>
            ))}
          </div>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}
