import { lazy, Suspense, useEffect, useState } from "react";
import MergeFieldPicker from "../components/content-editor/MergeFieldPicker.js";
import { api } from "../lib/api.js";
import type { Template } from "../lib/types.js";
import PreviewModal from "../components/PreviewModal.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Input,
  FormLabel,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  Popconfirm,
  Skeleton,
} from "../components/ui/index.js";

const HtmlEditor = lazy(() => import("../components/content-editor/HtmlEditor.js"));

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
    await api.delete(`/templates/${id}`);
    load();
  }

  return (
    <div>
      <PageHeaderWrapper
        variant="title-with-actions"
        title="Templates"
        actions={<Button onClick={startNew}>New template</Button>}
      />

      {editing && (
        <BlockLayout className="mb-6">
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <FormLabel required>Name</FormLabel>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FormLabel>Body (wrap the campaign content with {"{{ Body }}"})</FormLabel>
                <MergeFieldPicker scope="template" />
              </div>
              <Suspense fallback={<Skeleton className="h-48" />}>
                <HtmlEditor value={body} onChange={setBody} />
              </Suspense>
            </div>
            <div className="flex gap-2">
              <Button type="submit">Save</Button>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={showPreview}
                disabled={previewLoading}
              >
                {previewLoading ? "Loading preview…" : "Preview"}
              </Button>
              {previewError && <span className="text-destructive text-sm">{previewError}</span>}
            </div>
          </form>
        </BlockLayout>
      )}

      {preview && <PreviewModal html={preview} onClose={() => setPreview(null)} />}

      <BlockLayout padding="sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.name}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => startEdit(t)}>
                      Edit
                    </Button>
                    <Popconfirm
                      description="Delete this template?"
                      onConfirm={() => remove(t.id)}
                      confirmText="Delete"
                    >
                      <Button variant="outline" size="sm">
                        Delete
                      </Button>
                    </Popconfirm>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {templates.length === 0 && (
          <TableEmptyState
            title="No templates yet"
            description="Campaigns can also be sent without one."
          />
        )}
      </BlockLayout>
    </div>
  );
}
