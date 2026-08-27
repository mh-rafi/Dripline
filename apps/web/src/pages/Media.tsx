import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, FileText, Trash2, Upload } from "lucide-react";
import { api, ApiError } from "../lib/api.js";
import type { MediaItem } from "../lib/types.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Input,
  Alert,
  AlertTitle,
  AlertDescription,
  Popconfirm,
  Skeleton,
  TableEmptyState,
  TablePagination,
  toast,
} from "../components/ui/index.js";

interface MediaPage {
  results: MediaItem[];
  total: number;
  page: number;
  per_page: number;
}

const IMAGE_TYPES = /^image\//;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export default function Media() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(30);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (query) params.set("query", query);
      const res = await api.get<MediaPage>(`/media?${params}`);
      setItems(res.results);
      setTotal(res.total);
      setConfigError(null);
    } catch (err) {
      setItems([]);
      setTotal(0);
      // A 400 here is the storage backend not being configured yet, which is
      // guidance rather than a failure -- anything else is a real error.
      if (err instanceof ApiError && err.status === 400) setConfigError(err.message);
      else toast.error(err instanceof Error ? err.message : "failed to load media");
    } finally {
      setLoading(false);
    }
  }, [page, perPage, query]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    let uploaded = 0;
    for (const file of Array.from(files)) {
      try {
        await api.upload<MediaItem>("/media", file);
        uploaded++;
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`);
      }
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    if (uploaded > 0) {
      toast.success(`Uploaded ${uploaded} file${uploaded === 1 ? "" : "s"}`);
      setPage(1);
      await load();
    }
  }

  async function remove(item: MediaItem) {
    try {
      await api.delete(`/media/${item.id}`);
      toast.success("File deleted");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to delete file");
    }
  }

  async function copyUrl(item: MediaItem) {
    try {
      await navigator.clipboard.writeText(item.url);
      toast.success("URL copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  return (
    <div>
      <PageHeaderWrapper
        variant="title-with-actions"
        title="Media"
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => upload(e.target.files)}
            />
            <Button
              onClick={() => fileInput.current?.click()}
              disabled={uploading || configError !== null}
            >
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </>
        }
      />

      {configError && (
        <Alert variant="warning" className="mb-6">
          <AlertTitle>Media storage isn&apos;t configured</AlertTitle>
          <AlertDescription>
            {configError}. Add your S3 credentials under{" "}
            <Link to="/settings" className="underline">
              Settings → Media
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      <BlockLayout padding="sm">
        <div className="mb-4 flex items-center gap-2">
          <Input
            placeholder="Search files…"
            value={query}
            onChange={(e) => {
              setPage(1);
              setQuery(e.target.value);
            }}
            className="max-w-xs"
          />
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <TableEmptyState
            title="No files yet"
            description={
              configError
                ? "Configure S3 storage to start uploading."
                : "Upload one to get started."
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {items.map((item) => (
              <div key={item.id} className="group bg-card overflow-hidden rounded-md border">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-muted flex h-32 items-center justify-center overflow-hidden"
                >
                  {IMAGE_TYPES.test(item.content_type) ? (
                    <img
                      src={item.url}
                      alt={item.filename}
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <FileText className="text-muted-foreground h-8 w-8" />
                  )}
                </a>
                <div className="space-y-1 p-2">
                  <div className="truncate text-xs font-medium" title={item.filename}>
                    {item.filename}
                  </div>
                  <div className="text-muted-foreground flex items-center justify-between text-xs">
                    <span>{formatSize(item.size)}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm-icon"
                        tooltip="Copy URL"
                        onClick={() => copyUrl(item)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Popconfirm
                        description={`Delete ${item.filename}?`}
                        onConfirm={() => remove(item)}
                        confirmText="Delete"
                      >
                        <Button variant="ghost" size="sm-icon" allowNoTooltip>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </Popconfirm>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {total > 0 && (
          <div className="mt-4">
            <TablePagination
              current={page}
              pageSize={perPage}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPerPage(size);
                setPage(1);
              }}
              pageSizeOptions={[30, 60, 100]}
            />
          </div>
        )}
      </BlockLayout>
    </div>
  );
}
