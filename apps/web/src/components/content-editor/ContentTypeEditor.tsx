import { lazy, Suspense } from "react";
import PlainTextEditor from "./PlainTextEditor.js";
import MergeFieldPicker, { type MergeFieldScope } from "./MergeFieldPicker.js";
import type { ContentType } from "../../lib/types.js";
import { convertContent, isLossyTarget, type ContentValue } from "../../lib/contentConversion.js";
import { Button, Skeleton } from "../ui/index.js";

// Lazy-loaded: TinyMCE, GrapesJS, and CodeMirror are each substantial on
// their own -- most sessions only ever touch one editing mode, so nobody
// should pay for downloading all of them upfront just to write a plaintext
// campaign. PlainTextEditor is trivial and loaded eagerly above.
const RichTextEditor = lazy(() => import("./RichTextEditor.js"));
const HtmlEditor = lazy(() => import("./HtmlEditor.js"));
const MarkdownEditor = lazy(() => import("./MarkdownEditor.js"));
const VisualEditor = lazy(() => import("./VisualEditor.js"));

export type { ContentType, ContentValue };

export const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: "richtext", label: "Rich text" },
  { value: "html", label: "Raw HTML" },
  { value: "markdown", label: "Markdown" },
  { value: "plain", label: "Plain text" },
  { value: "visual", label: "Visual" },
];

interface ContentTypeEditorProps {
  contentType: ContentType;
  value: ContentValue;
  onChangeType: (type: ContentType) => void;
  onChangeValue: (value: ContentValue) => void;
  /** Restricts the offered modes. Automation emails use this to leave out the
   * visual builder, which needs far more room than the builder's sidebar. */
  allowedTypes?: ContentType[];
  /** Which merge fields the picker offers -- an automation email resolves
   * different ones than a campaign. */
  mergeFieldScope?: MergeFieldScope;
}

/**
 * Switches between the 5 body editing modes listmonk supports, matching its
 * data model: `body` is always the final HTML actually sent (converted from
 * markdown at dispatch time -- see apps/api/src/lib/markdown.ts -- rather
 * than pre-converted here), `body_source` is the original editor source
 * where one exists separately from `body` (markdown text, the visual
 * builder's JSON project data).
 *
 * Switching between richtext/html/markdown converts the current content
 * rather than discarding it (see lib/contentConversion.ts), matching
 * listmonk. Plain text and the visual builder are inherently lossy targets
 * -- switching to either still carries content across best-effort, but a
 * confirm dialog warns first since real formatting can't survive.
 */
export default function ContentTypeEditor({
  contentType,
  value,
  onChangeType,
  onChangeValue,
  allowedTypes,
  mergeFieldScope = "campaign",
}: ContentTypeEditorProps) {
  const types = allowedTypes
    ? CONTENT_TYPES.filter((t) => allowedTypes.includes(t.value))
    : CONTENT_TYPES;
  function switchTo(newType: ContentType) {
    if (newType === contentType) return;
    if (isLossyTarget(newType) && (value.body.trim() || value.body_source?.trim())) {
      const proceed = confirm(
        `Switching to "${CONTENT_TYPES.find((t) => t.value === newType)?.label}" may lose formatting from your current content and can't be undone. Continue?`,
      );
      if (!proceed) return;
    }
    onChangeValue(convertContent(contentType, newType, value));
    onChangeType(newType);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {types.map((t) => (
            <Button
              key={t.value}
              type="button"
              variant={contentType === t.value ? "default" : "outline"}
              onClick={() => switchTo(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        {/* ml-auto keeps the picker right-aligned even when the toolbar wraps
            onto a second line (the automation builder's sidebar is narrow). */}
        <div className="ml-auto">
          <MergeFieldPicker scope={mergeFieldScope} />
        </div>
      </div>

      {contentType === "plain" ? (
        <PlainTextEditor
          value={value.body}
          onChange={(text) => onChangeValue({ body: text, body_source: text })}
        />
      ) : (
        <Suspense fallback={<Skeleton className="h-48" />}>
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
