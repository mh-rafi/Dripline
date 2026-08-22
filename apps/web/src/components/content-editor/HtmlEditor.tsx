import CodeMirror from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";

interface HtmlEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function HtmlEditor({ value, onChange }: HtmlEditorProps) {
  return (
    <CodeMirror
      value={value}
      height="440px"
      theme="dark"
      extensions={[html()]}
      onChange={onChange}
    />
  );
}
