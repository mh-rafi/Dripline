import { useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { ImagePlus, Library, Link2, Upload, X } from "lucide-react";
import { api } from "../../lib/api.js";
import type { MediaItem } from "../../lib/types.js";
import MediaPickerDialog from "../MediaPickerDialog.js";
import { Button, Input, toast } from "../ui/index.js";

export const IMAGE_PLACEHOLDER_NAME = "imagePlaceholder";
/** The attribute the node serializes with, and the hook stripPlaceholders()
 * in RichTextEditor uses to keep these out of the saved body. */
export const IMAGE_PLACEHOLDER_ATTR = "data-image-placeholder";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    imagePlaceholder: {
      insertImagePlaceholder: () => ReturnType;
    };
  }
}

function ImagePlaceholderView({ editor, node, getPos, deleteNode }: ReactNodeViewProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [url, setUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  /** Swaps this placeholder for a real image node, in one transaction so a
   * single undo takes the whole insertion back. */
  function resolveTo(src: string, alt?: string) {
    const pos = getPos();
    if (pos == null) return;
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: pos, to: pos + node.nodeSize },
        { type: "image", attrs: { src, alt: alt || null } },
      )
      .run();
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("That file isn't an image");
      return;
    }
    setUploading(true);
    try {
      const item = await api.upload<MediaItem>("/media", file);
      resolveTo(item.url, item.filename);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    // contentEditable={false} keeps ProseMirror from treating the buttons and
    // the URL field as editable document content.
    <NodeViewWrapper
      className="my-3"
      contentEditable={false}
      data-drag-handle={false}
      onDragOver={(e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        upload(e.dataTransfer.files[0]);
      }}
    >
      <div
        className={`relative flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-6 transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-input bg-muted/30"
        }`}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm-icon"
          tooltip="Remove"
          className="absolute top-1 right-1"
          onClick={() => deleteNode()}
        >
          <X className="h-3.5 w-3.5" />
        </Button>

        <ImagePlus className="text-muted-foreground h-7 w-7" />
        <p className="text-muted-foreground text-center text-sm">
          {uploading ? "Uploading…" : "Drop an image here, or choose one"}
        </p>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => upload(e.target.files?.[0])}
        />

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="mr-2 h-3.5 w-3.5" /> Upload
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => setPickerOpen(true)}
          >
            <Library className="mr-2 h-3.5 w-3.5" /> Media library
          </Button>
        </div>

        {urlMode ? (
          <div className="flex w-full max-w-sm items-center gap-2">
            <Input
              autoFocus
              placeholder="https://example.com/image.png"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && url.trim()) {
                  e.preventDefault();
                  resolveTo(url.trim());
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={!url.trim()}
              onClick={() => resolveTo(url.trim())}
            >
              Insert
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline underline-offset-2"
            onClick={() => setUrlMode(true)}
          >
            <Link2 className="h-3 w-3" /> or use an image URL
          </button>
        )}
      </div>

      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        imagesOnly
        title="Insert an image"
        onSelect={(item) => resolveTo(item.url, item.filename)}
      />
    </NodeViewWrapper>
  );
}

/** An empty, non-serialising slot the author fills by uploading, picking from
 * the media library, dropping a file on it, or pasting a URL. It only ever
 * exists while the editor is open -- see stripPlaceholders() in
 * RichTextEditor, which keeps it out of the saved HTML. */
export const ImagePlaceholder = Node.create({
  name: IMAGE_PLACEHOLDER_NAME,
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: `div[${IMAGE_PLACEHOLDER_ATTR}]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { [IMAGE_PLACEHOLDER_ATTR]: "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImagePlaceholderView);
  },

  addCommands() {
    return {
      // Inserted *after* the selection rather than over it: a plain
      // insertContent() replaces whatever is selected, so clicking the
      // toolbar button with an image node-selected (exactly the state the
      // editor is left in right after inserting one) silently destroyed it.
      insertImagePlaceholder:
        () =>
        ({ commands, state }) =>
          commands.insertContentAt(state.selection.to, { type: this.name }),
    };
  },
});
