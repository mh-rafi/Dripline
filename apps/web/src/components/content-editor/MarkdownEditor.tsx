import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { marked } from "marked";

marked.setOptions({ breaks: true, gfm: true });

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
}

/** Markdown source editor + live preview. The preview is client-side only,
 * for feedback while typing -- the authoritative HTML conversion happens
 * server-side at send time (see apps/api/src/lib/markdown.ts), using the
 * same `marked` library so the two stay visually consistent. */
export default function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  const previewHtml = marked.parse(value, { async: false }) as string;

  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <CodeMirror
          value={value}
          height="440px"
          theme="dark"
          extensions={[markdown()]}
          onChange={onChange}
        />
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          height: 440,
          overflow: "auto",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 12,
          background: "#fff",
          color: "#111",
        }}
        dangerouslySetInnerHTML={{ __html: previewHtml }}
      />
    </div>
  );
}
