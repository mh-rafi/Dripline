import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { Template } from "../lib/types.js";
import PreviewModal from "../components/PreviewModal.js";

// Lazy, matching ContentTypeEditor's own dynamic import of the same module --
// Rollup shares the one chunk between both, so this doesn't cost a second
// download; a static import here would have pulled CodeMirror into the main
// bundle for every page, not just Templates/campaign editing.
const HtmlEditor = lazy(() => import("../components/content-editor/HtmlEditor.js"));

// A styled starting point rather than a bare wrapper -- bigger headings,
// underlined orange links, hr dividers, and a left-border blockquote so a
// campaign looks like a designed newsletter without the campaign author
// having to write any CSS themselves. Different campaigns get different
// looks by picking a different template, not by editing the shared rich
// text editor's output.
const DEFAULT_BODY = `<!DOCTYPE html>
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
</style>
</head>
<body>
  <div class="email-wrapper">
    {{ Body }}
  </div>
</body>
</html>`;

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState(DEFAULT_BODY);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function showPreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await api.post<{ html: string }>("/templates/preview", { body });
      setPreview(result.html);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }

  function load() {
    api.get<Template[]>("/templates").then(setTemplates);
  }
  useEffect(load, []);

  function startNew() {
    setEditing({ id: 0, name: "", subject: "", body: DEFAULT_BODY, is_default: false });
    setName("");
    setBody(DEFAULT_BODY);
  }

  function startEdit(t: Template) {
    setEditing(t);
    setName(t.name);
    setBody(t.body);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (editing.id === 0) {
      await api.post("/templates", { name, body });
    } else {
      await api.patch(`/templates/${editing.id}`, { name, body });
    }
    setEditing(null);
    load();
  }

  async function remove(id: number) {
    if (!confirm("Delete this template?")) return;
    await api.delete(`/templates/${id}`);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <h2>Templates</h2>
        <button onClick={startNew}>New template</button>
      </div>

      {editing && (
        <form className="card" onSubmit={save}>
          <label>Name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} />
          <label>Body (wrap the campaign content with {"{{ Body }}"})</label>
          <Suspense fallback={<p className="muted">Loading editor…</p>}>
            <HtmlEditor value={body} onChange={setBody} />
          </Suspense>
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="submit">Save</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="secondary"
              onClick={showPreview}
              disabled={previewLoading}
            >
              {previewLoading ? "Loading preview…" : "Preview"}
            </button>
            {previewError && <span className="error-text">{previewError}</span>}
          </div>
        </form>
      )}

      {preview && <PreviewModal html={preview} onClose={() => setPreview(null)} />}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td className="toolbar" style={{ marginBottom: 0 }}>
                <button className="secondary" onClick={() => startEdit(t)}>
                  Edit
                </button>
                <button className="secondary" onClick={() => remove(t.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {templates.length === 0 && (
            <tr>
              <td colSpan={2} className="muted">
                No templates yet — campaigns can also be sent without one.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
