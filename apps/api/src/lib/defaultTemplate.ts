/** The template a fresh install starts with, seeded by services/seed.ts.
 * Kept here rather than in the admin UI so the seeded copy is the only copy --
 * the UI reads it back from the API when starting a new template. */
export const DEFAULT_TEMPLATE_NAME = "Default";

export const DEFAULT_TEMPLATE_BODY = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 0; background: #f4f4f5; }
  .email-wrapper {
    max-width: 600px;
    margin: 0 auto;
    padding: 32px 24px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #2d2d2f;
    font-size: 16px;
    line-height: 1.6;
    background: #ffffff;
  }
  .email-wrapper h1, .email-wrapper h2, .email-wrapper h3 {
    font-weight: 700;
    color: #111111;
    line-height: 1.3;
    margin: 1.2em 0 0.5em;
  }
  .email-wrapper h1 { font-size: 1.8em; }
  .email-wrapper h2 { font-size: 1.5em; }
  .email-wrapper h3 { font-size: 1.2em; }
  .email-wrapper p { margin: 1em 0; }
  .email-wrapper a { color: #f87000; text-decoration: underline; }
  .email-wrapper hr { border: none; border-top: 1px solid #e5e5e5; margin: 2em 0; }
  .email-wrapper blockquote {
    margin: 0 0 1.5em;
    padding: 10px 20px;
    border-left: 4px solid #e5e5e5;
    color: #555555;
  }
  .email-wrapper img { max-width: 100%; height: auto; }
  .email-footer {
    margin-top: 2.5em;
    padding-top: 1.5em;
    border-top: 1px solid #e5e5e5;
    font-size: 13px;
    line-height: 1.5;
    color: #767678;
  }
  .email-footer a { color: #767678; }
</style>
</head>
<body>
  <div class="email-wrapper">
    {{ Body }}
    <div class="email-footer">
      You are receiving this email because you subscribed to our list.<br>
      <a href="{{ UnsubscribeURL }}">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`;
