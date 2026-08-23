import { marked } from "marked";
import TurndownService from "turndown";
import type { ContentType } from "./types.js";

marked.setOptions({ breaks: true, gfm: true });
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export interface ContentValue {
  body: string;
  body_source: string | null;
}

function htmlToPlainText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").trim();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Types are lossy conversion targets: switching to one of these can't
 * preserve the source's formatting, only its content (or less). */
export function isLossyTarget(to: ContentType): boolean {
  return to === "plain" || to === "visual";
}

/**
 * Converts an editor's current content between content-type "families" so
 * that switching between richtext/html/markdown never loses formatting,
 * matching listmonk. Plain text and the visual builder are inherently lossy
 * targets (see `isLossyTarget`) -- this still does a best-effort conversion
 * for them (plain: strip to visible text; visual: hand the current HTML to
 * GrapesJS to import) rather than wiping to blank.
 */
export function convertContent(
  from: ContentType,
  to: ContentType,
  value: ContentValue,
): ContentValue {
  if (from === to) return value;

  let html: string;
  if (from === "markdown") {
    html = marked.parse(value.body || "", { async: false }) as string;
  } else if (from === "plain") {
    html = value.body ? `<p>${escapeHtml(value.body).replace(/\n/g, "<br>")}</p>` : "";
  } else {
    // richtext, html, and visual all store real HTML in `body`.
    html = value.body;
  }

  switch (to) {
    case "richtext":
    case "html":
      return { body: html, body_source: html };
    case "markdown": {
      const md = html ? turndown.turndown(html) : "";
      return { body: md, body_source: md };
    }
    case "plain":
      return { body: htmlToPlainText(html), body_source: null };
    case "visual":
      // VisualEditor seeds itself from its `initialHtml` prop only when
      // there's no saved `projectData` -- null here makes it import fresh
      // from this HTML instead of reusing a stale visual project.
      return { body: html, body_source: null };
  }
}
