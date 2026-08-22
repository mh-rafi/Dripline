import { Editor } from "@tinymce/tinymce-react";

// Self-hosted TinyMCE (no cloud API key / no external script fetch) -- bundled
// directly via the `tinymce` npm package, per TinyMCE's own Vite/bundler guide.
import "tinymce/tinymce";
import "tinymce/icons/default";
import "tinymce/themes/silver";
import "tinymce/models/dom";
import "tinymce/skins/ui/oxide/skin.css";
import "tinymce/skins/ui/oxide/content.css";
import "tinymce/skins/content/default/content.css";
import "tinymce/plugins/link";
import "tinymce/plugins/lists";
import "tinymce/plugins/image";
import "tinymce/plugins/table";
import "tinymce/plugins/code";
import "tinymce/plugins/media";
import "tinymce/plugins/autolink";
import "tinymce/plugins/wordcount";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
}

export default function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  return (
    <Editor
      licenseKey="gpl"
      value={value}
      onEditorChange={onChange}
      init={{
        height: 440,
        menubar: false,
        skin: false,
        content_css: false,
        plugins: "link lists image table code media autolink wordcount",
        toolbar:
          "undo redo | blocks | bold italic underline | forecolor backcolor | " +
          "alignleft aligncenter alignright | bullist numlist outdent indent | " +
          "link image table | removeformat code",
        branding: false,
        promotion: false,
      }}
    />
  );
}
