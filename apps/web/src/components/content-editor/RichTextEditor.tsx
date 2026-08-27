import { useEffect, useMemo } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { ImagePlaceholder, IMAGE_PLACEHOLDER_ATTR } from "./ImagePlaceholder.js";
import RichTextToolbar from "./RichTextToolbar.js";
import { Skeleton } from "../ui/index.js";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
}

const CONTENT_CLASS = [
  "min-h-[360px] px-4 py-3 text-sm leading-relaxed focus:outline-none",
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-semibold",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold",
  "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-lg [&_h3]:font-semibold",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_li]:my-0.5",
  "[&_blockquote]:border-border [&_blockquote]:text-muted-foreground [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_hr]:border-border [&_hr]:my-4",
  "[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md",
  "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_pre]:bg-muted [&_pre]:my-2 [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:overflow-x-auto",
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse",
  "[&_td]:border-border [&_td]:border [&_td]:p-2",
  "[&_th]:border-border [&_th]:bg-muted [&_th]:border [&_th]:p-2 [&_th]:font-medium",
  "[&_.is-editor-empty:first-child::before]:text-muted-foreground [&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
].join(" ");

// A fresh array built per mounted editor instance (see the `useMemo` below),
// not a shared module-level singleton: `useEditor` compares `extensions`
// element-by-element across renders and live-reconfigures the editor
// whenever an entry's identity changes, so recreating these via `.configure()`
// on every render corrupted the schema mid-flight.
function createExtensions() {
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    }),
    TextStyleKit.configure({ fontFamily: false, fontSize: false, lineHeight: false }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Image,
    ImagePlaceholder,
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({ placeholder: "Write your email…" }),
  ];
}

const EDITOR_PROPS = {
  attributes: { class: CONTENT_CLASS },
};

/** Empty image placeholders are editing scaffolding, never content: an author
 * can insert one, leave it unfilled and save. Dropping them here means the
 * campaign body never carries a stray box, and -- because the parent's `value`
 * is always stripped -- the sync effect below has to compare against the
 * stripped HTML too, or every insert would immediately reset the document and
 * destroy the placeholder the author just added. */
function stripPlaceholders(html: string): string {
  if (!html.includes(IMAGE_PLACEHOLDER_ATTR)) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll(`[${IMAGE_PLACEHOLDER_ATTR}]`).forEach((el) => el.remove());
  return doc.body.innerHTML;
}

export default function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const extensions = useMemo(createExtensions, []);
  const editor = useEditor({
    // Defers creating the actual ProseMirror view until after the first
    // effect commit instead of synchronously during render. Without this,
    // React StrictMode's double-invoked effects raced the view's teardown
    // against its (re)creation and intermittently left `editor.schema` null
    // mid-flight, throwing inside ProseMirror's own schema cache lookup
    // (`schema.cached`) the next time something touched the editor.
    immediatelyRender: false,
    extensions,
    content: value,
    onUpdate: ({ editor }) => onChange(stripPlaceholders(editor.getHTML())),
    editorProps: EDITOR_PROPS,
  });

  // `useEditor` only seeds `content` on the initial mount -- this keeps the
  // editor in sync when `value` is replaced from outside (e.g. the campaign
  // finishes loading async, or a content-type conversion swaps the body)
  // without fighting the user's own typing.
  useEffect(() => {
    if (!editor) return;
    if (value !== stripPlaceholders(editor.getHTML())) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) {
    return <Skeleton className="h-[404px] w-full rounded-md" />;
  }

  return (
    <div className="border-input bg-background overflow-hidden rounded-md border">
      <RichTextToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
