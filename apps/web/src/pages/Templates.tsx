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
  DataTable,
  TableEmptyState,
  Skeleton,
} from "../components/ui/index.js";
import type { DataTableAction, DataTableColumn } from "../components/ui/index.js";

const HtmlEditor = lazy(() => import("../components/content-editor/HtmlEditor.js"));

// Starting point for a new template when the seeded default is gone (deleted,
// or an install that predates seeding). Deliberately minimal -- the real
// default lives in the database, see apps/api/src/lib/defaultTemplate.ts.
const FALLBACK_BODY = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  {{ Body }}
  <p><a href="{{ UnsubscribeURL }}">Unsubscribe</a></p>
</body>
</html>`;

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
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
    const starting = templates.find((t) => t.is_default)?.body ?? FALLBACK_BODY;
    setEditing({ id: 0, name: "", subject: "", body: starting, is_default: false });
    setName("");
    setBody(starting);
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

  const columns: DataTableColumn<Template>[] = [
    { key: "name", header: "Name", mobile: "title", cell: (t) => t.name },
  ];

  function rowActions(t: Template): DataTableAction[] {
    return [
      { label: "Edit", appearance: "outline", onClick: () => startEdit(t) },
      {
        label: "Delete",
        appearance: "outline",
        variant: "destructive",
        confirm: { description: "Delete this template?", confirmText: "Delete" },
        onClick: () => remove(t.id),
      },
    ];
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

      <DataTable
        columns={columns}
        rows={templates}
        rowKey={(t) => t.id}
        rowActions={rowActions}
        empty={
          <TableEmptyState
            title="No templates yet"
            description="Campaigns can also be sent without one."
          />
        }
      />
    </div>
  );
}
