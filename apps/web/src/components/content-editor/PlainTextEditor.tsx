interface PlainTextEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function PlainTextEditor({ value, onChange }: PlainTextEditorProps) {
  return (
    <textarea
      rows={20}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
    />
  );
}
