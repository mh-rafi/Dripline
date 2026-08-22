import Mustache from "mustache";

export interface TemplateContext {
  Subscriber: {
    ID: number;
    UUID: string;
    Email: string;
    Name: string;
    Attribs: Record<string, unknown>;
  };
  Campaign: {
    ID: number;
    UUID: string;
    Name: string;
    Subject: string;
  };
  UnsubscribeURL: string;
}

/** Renders a template body/subject against merge fields (e.g. {{Subscriber.Name}}). */
export function renderTemplate(source: string, context: TemplateContext): string {
  return Mustache.render(source, context, undefined, { escape: (v) => String(v) });
}

const HREF_RE = /(<a\b[^>]*\bhref\s*=\s*)(["'])(.*?)\2/gi;

/** Finds every unique <a href="..."> URL in an HTML body, skipping mailto/tel/anchors. */
export function extractLinks(html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(HREF_RE)) {
    const url = match[3];
    if (!url) continue;
    if (/^(mailto:|tel:|#)/i.test(url)) continue;
    urls.add(url);
  }
  return [...urls];
}

/** Rewrites <a href> URLs to tracked redirect URLs using a resolver map (url -> tracked URL). */
export function rewriteLinks(html: string, resolve: (url: string) => string | undefined): string {
  return html.replace(HREF_RE, (full, prefix: string, quote: string, url: string) => {
    const tracked = /^(mailto:|tel:|#)/i.test(url) ? undefined : resolve(url);
    return tracked ? `${prefix}${quote}${tracked}${quote}` : full;
  });
}

export function appendOpenPixel(html: string, pixelUrl: string): string {
  const img = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;max-height:0;max-width:0;opacity:0" />`;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${img}</body>`);
  }
  return `${html}${img}`;
}
