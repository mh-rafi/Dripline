/**
 * Builds the `text/plain` half of a multipart/alternative email from a
 * rendered HTML body. Sending HTML with no text part is a standing
 * SpamAssassin penalty (MIME_HTML_ONLY) on every message -- see
 * docs/plan/deliverability.md.
 *
 * Regex-based on purpose. The input is our own rendered template HTML, which
 * is the same assumption extractLinks/rewriteLinks in template.ts already
 * make, and pulling in a full HTML parser to produce one MIME part isn't
 * worth the dependency.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  zwnj: "",
  zwj: "",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (full, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    }
    const named = ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : full;
  });
}

export function htmlToText(html: string): string {
  let s = html;

  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, "");

  // The hidden preheader div (see injectPreheader in services/mailer.ts) would
  // otherwise show up as a wall of padding characters at the top of the text
  // part. Matching to the first </div> is correct for that one -- it holds
  // escaped text, never nested markup.
  s = s.replace(/<div\b[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/div>/gi, "");

  // Link text and destination both matter in the text part: a reader with
  // images off should still be able to reach what the HTML linked to.
  s = s.replace(
    /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (full, _q: string, href: string, inner: string) => {
      if (/^(mailto:|tel:|#)/i.test(href)) return inner;
      const label = decodeEntities(inner.replace(/<[^>]+>/g, "")).trim();
      const url = decodeEntities(href).trim();
      if (!url) return full;
      return !label || label === url ? url : `${label} ( ${url} )`;
    },
  );

  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");
  // Trailing whitespace goes with the closing tag, or the newline between
  // two <li>s in the source would leave a blank line between the bullets.
  s = s.replace(/<\/li>\s*/gi, "");
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");
  s = s.replace(/<\/(td|th)>\s*/gi, "  ");
  s = s.replace(
    /<\/?(p|div|tr|table|thead|tbody|ul|ol|h[1-6]|blockquote|section|article|header|footer|pre)\b[^>]*>/gi,
    "\n\n",
  );

  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);

  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(/[^\S\n]+/g, " ");
  s = s
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}
