interface PreviewModalProps {
  subject?: string;
  html: string;
  onClose: () => void;
}

/** Renders rendered-email HTML in an iframe (via srcDoc), not
 * dangerouslySetInnerHTML directly in the page -- a template's own <style>
 * block (e.g. targeting `body`) would otherwise leak into the whole admin
 * app's styles. */
export default function PreviewModal({ subject, html, onClose }: PreviewModalProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: "min(700px, 92vw)",
          height: "min(800px, 90vh)",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <div>
            <strong>Preview</strong>
            {subject && (
              <div className="muted" style={{ fontSize: 13 }}>
                {subject}
              </div>
            )}
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <iframe
          title="Email preview"
          srcDoc={html}
          style={{ flex: 1, border: "none", background: "#ffffff" }}
        />
      </div>
    </div>
  );
}
