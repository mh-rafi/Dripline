import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { api, ApiError } from "../lib/api.js";
import type { MediaItem } from "../lib/types.js";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  TablePagination,
  toast,
} from "./ui/index.js";

interface MediaPage {
  results: MediaItem[];
  total: number;
  page: number;
  per_page: number;
}

interface MediaPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: MediaItem) => void;
  /** Restricts the listing to images. Server-side, so pagination stays honest. */
  imagesOnly?: boolean;
  title?: string;
}

const PER_PAGE = 12;

export default function MediaPickerDialog({
  open,
  onOpenChange,
  onSelect,
  imagesOnly = false,
  title = "Media library",
}: MediaPickerDialogProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (query) params.set("query", query);
      if (imagesOnly) params.set("type", "image");
      const res = await api.get<MediaPage>(`/media?${params}`);
      setItems(res.results);
      setTotal(res.total);
      setConfigError(null);
    } catch (err) {
      setItems([]);
      setTotal(0);
      if (err instanceof ApiError && err.status === 400) setConfigError(err.message);
      else toast.error(err instanceof Error ? err.message : "failed to load media");
    } finally {
      setLoading(false);
    }
  }, [page, query, imagesOnly]);

  // Refetching on open keeps the grid current with anything uploaded from the
  // Media page (or another placeholder) since the dialog was last shown.
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const item = await api.upload<MediaItem>("/media", files[0]!);
      onSelect(item);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Pick a file, or upload a new one. Files are also managed on the Media page.
          </DialogDescription>
        </DialogHeader>

        {configError && (
          <Alert variant="warning">
            <AlertDescription>
              {configError}. Add your S3 credentials under Settings → Media.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-2">
          <Input
            placeholder="Search files…"
            value={query}
            onChange={(e) => {
              setPage(1);
              setQuery(e.target.value);
            }}
            className="max-w-xs"
          />
          <input
            ref={fileInput}
            type="file"
            accept={imagesOnly ? "image/*" : undefined}
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInput.current?.click()}
            disabled={uploading || configError !== null}
          >
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: PER_PAGE }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground py-10 text-center text-sm">
              {query ? "No files match that search." : "No files uploaded yet."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelect(item);
                    onOpenChange(false);
                  }}
                  className="group hover:border-primary focus-visible:border-primary overflow-hidden rounded-md border text-left transition-colors focus-visible:outline-none"
                >
                  <div className="bg-muted flex h-24 items-center justify-center overflow-hidden">
                    <img
                      src={item.url}
                      alt={item.filename}
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="truncate p-1.5 text-xs" title={item.filename}>
                    {item.filename}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {total > PER_PAGE && (
          <TablePagination
            current={page}
            pageSize={PER_PAGE}
            total={total}
            onPageChange={setPage}
            pageSizeOptions={[PER_PAGE]}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
