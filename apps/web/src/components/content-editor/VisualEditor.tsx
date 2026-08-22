import { useEffect, useRef } from "react";
import grapesjs, { type Editor as GrapesEditor } from "grapesjs";
import grapesjsPresetNewsletter from "grapesjs-preset-newsletter";
import "grapesjs/dist/css/grapes.min.css";

interface VisualEditorProps {
  /** JSON GrapesJS project data (from a previous session), or null to start blank/from `initialHtml`. */
  projectData: string | null;
  /** Only used to seed a brand new (no projectData) editor. */
  initialHtml: string;
  onChange: (next: { html: string; projectData: string }) => void;
}

/**
 * Drag-and-drop email builder via GrapesJS + grapesjs-preset-newsletter.
 * Framework-agnostic (no React/MUI dependency, unlike listmonk's vendored
 * usewaypoint/email-builder-js) -- mounts imperatively into a plain div.
 *
 * `body` (sent to the API) is `<style>{css}</style>{html}`. There's no CSS
 * inlining (e.g. via juice) in this version -- most modern mail clients
 * handle a <style> block fine, but very old Outlook versions prefer fully
 * inlined styles. Noted as a known follow-up in the development plan.
 */
export default function VisualEditor({ projectData, initialHtml, onChange }: VisualEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<GrapesEditor | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const editor = grapesjs.init({
      container: containerRef.current,
      height: "600px",
      fromElement: false,
      storageManager: false,
      plugins: [grapesjsPresetNewsletter],
    });
    editorRef.current = editor;

    if (projectData) {
      try {
        editor.loadProjectData(JSON.parse(projectData));
      } catch {
        // Corrupt/incompatible saved project data -- fall back to blank rather
        // than crashing the page; the admin can rebuild the design.
      }
    } else if (initialHtml) {
      editor.setComponents(initialHtml);
    }

    const emit = () => {
      const html = editor.getHtml();
      const css = editor.getCss() ?? "";
      onChange({
        html: css ? `<style>${css}</style>${html}` : html,
        projectData: JSON.stringify(editor.getProjectData()),
      });
    };
    editor.on("update", emit);

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
    // Intentionally mount once -- projectData/initialHtml are only used to
    // seed the editor on first load, not to re-sync on every parent re-render.
  }, []);

  return <div ref={containerRef} />;
}
