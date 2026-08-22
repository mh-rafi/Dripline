import { lazy, Suspense } from "react";
import PlainTextEditor from "./PlainTextEditor.js";
import type { ContentType } from "../../lib/types.js";

// Lazy-loaded: TinyMCE, GrapesJS, and CodeMirror are each substantial on
// their own -- most sessions only ever touch one editing mode, so nobody
// should pay for downloading all of them upfront just to write a plaintext
// campaign. PlainTextEditor is trivial and loaded eagerly above.
const RichTextEditor = lazy(() => import("./RichTextEditor.js"));
const HtmlEditor = lazy(() => import("./HtmlEditor.js"));
const MarkdownEditor = lazy(() => import("./MarkdownEditor.js"));
const VisualEditor = lazy(() => import("./VisualEditor.js"));

export type { ContentType };

export const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: "richtext", label: "Rich text" },
  { value: "html", label: "Raw HTML" },
  { value: "markdown", label: "Markdown" },
  { value: "plain", label: "Plain text" },
  { value: "visual", label: "Visual" },
];

export interface ContentValue {
  body: string;
  body_source: string | null;
}

interface ContentTypeEditorProps {
  contentType: ContentType;
  value: ContentValue;
  onChangeType: (type: ContentType) => void;
  onChangeValue: (value: ContentValue) => void;
}

/**
 * Switches between the 5 body editing modes listmonk supports, matching its
 * data model: `body` is always the final HTML actually sent (converted from
 * markdown at dispatch time -- see apps/api/src/lib/markdown.ts -- rather
 * than pre-converted here), `body_source` is the original editor source
 * where one exists separately from `body` (markdown text, the visual
 * builder's JSON project data).
 */
export default function ContentTypeEditor({
  contentType,
  value,
  onChangeType,
  onChangeValue,
}: ContentTypeEditorProps) {
  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        {CONTENT_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            className={contentType === t.value ? "" : "secondary"}
            onClick={() => onChangeType(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {contentType === "plain" ? (
        <PlainTextEditor
          value={value.body}
          onChange={(text) => onChangeValue({ body: text, body_source: text })}
        />
      ) : (
        <Suspense fallback={<p className="muted">Loading editor…</p>}>
          {contentType === "richtext" && (
            <RichTextEditor
              value={value.body}
              onChange={(html) => onChangeValue({ body: html, body_source: html })}
            />
          )}

          {contentType === "html" && (
            <HtmlEditor
              value={value.body}
              onChange={(html) => onChangeValue({ body: html, body_source: html })}
            />
          )}

          {contentType === "markdown" && (
            <MarkdownEditor
              value={value.body}
              onChange={(md) => onChangeValue({ body: md, body_source: md })}
            />
          )}

          {contentType === "visual" && (
            <VisualEditor
              key={contentType}
              projectData={value.body_source}
              initialHtml={value.body}
              onChange={({ html, projectData }) =>
                onChangeValue({ body: html, body_source: projectData })
              }
            />
          )}
        </Suspense>
      )}
    </div>
  );
}
