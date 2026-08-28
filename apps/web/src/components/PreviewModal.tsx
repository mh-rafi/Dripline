import { Dialog, DialogContent, DialogHeader, DialogTitle, Button } from "./ui/index.js";

interface PreviewModalProps {
  subject?: string;
  preheader?: string;
  html: string;
  onClose: () => void;
}

/** Renders rendered-email HTML in an iframe (via srcDoc), not
 * dangerouslySetInnerHTML directly in the page -- a template's own <style>
 * block (e.g. targeting `body`) would otherwise leak into the whole admin
 * app's styles. */
export default function PreviewModal({ subject, preheader, html, onClose }: PreviewModalProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex h-[min(800px,90vh)] w-[min(700px,92vw)] max-w-3xl flex-col p-0">
        <DialogHeader className="border-border flex-row items-center justify-between space-y-0 border-b px-4 py-3">
          <div>
            <DialogTitle className="text-base">Preview</DialogTitle>
            {/* The preheader is invisible in the rendered body below (that's
                the point) -- this is the only place in the UI it's actually
                visible, mimicking the inbox row it's written for. */}
            {subject && (
              <p className="text-muted-foreground text-sm">
                {subject}
                {preheader && <span className="text-muted-foreground/70"> — {preheader}</span>}
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogHeader>
        <iframe title="Email preview" srcDoc={html} className="flex-1 border-none bg-white" />
      </DialogContent>
    </Dialog>
  );
}
