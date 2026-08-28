import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Connection, Settings, SystemSettings } from "../lib/types.js";
import {
  Alert,
  AlertDescription,
  Button,
  ButtonWithLoading,
  FormLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Typography,
  toast,
} from "./ui/index.js";

const NONE = "none";

export default function SystemSettingsForm() {
  const [form, setForm] = useState<SystemSettings | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [testTo, setTestTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api
      .get<Settings>("/settings")
      .then((s) => setForm(s.system))
      .catch((err) => toast.error(err instanceof Error ? err.message : "failed to load settings"));
    api
      .get<Connection[]>("/connections")
      .then(setConnections)
      .catch(() => setConnections([]));
  }, []);

  if (!form) return <Skeleton className="h-64 w-full" />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const saved = await api.put<Settings>("/settings", { system: form });
      setForm(saved.system);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      await api.post("/settings/system/test", { to: testTo });
      toast.success(`Test email sent to ${testTo}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to send test email");
    } finally {
      setTesting(false);
    }
  }

  const selected = connections.find((c) => c.id === form.connection_id);

  return (
    <div className="max-w-xl space-y-6">
      <form onSubmit={save} className="space-y-4">
        <div className="space-y-2">
          <FormLabel>System email connection</FormLabel>
          <Select
            value={form.connection_id === null ? NONE : String(form.connection_id)}
            onValueChange={(v) =>
              setForm({ ...form, connection_id: v === NONE ? null : Number(v) })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None — system email disabled</SelectItem>
              {connections.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name} ({c.from_email}){c.enabled ? "" : " — disabled"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            Which{" "}
            <Link to="/connections" className="text-primary hover:underline">
              connection
            </Link>{" "}
            Dripline sends its own mail through — password reset links today, more operational email
            later. It is separate from the connections a campaign sends on, so system mail does not
            go out under a campaign&apos;s sending identity.
          </p>
        </div>

        {form.connection_id === null && (
          <Alert>
            <AlertDescription>
              With no connection set, nobody can reset a forgotten password by email — an admin has
              to change it for them from the Users tab.
            </AlertDescription>
          </Alert>
        )}
        {selected && !selected.enabled && (
          <Alert variant="destructive">
            <AlertDescription>
              {selected.name} is currently disabled, so system email will not send.
            </AlertDescription>
          </Alert>
        )}

        <ButtonWithLoading type="submit" loading={saving}>
          Save
        </ButtonWithLoading>
      </form>

      <div className="border-border space-y-2 border-t pt-6">
        <Typography variant="h3">Send a test</Typography>
        <p className="text-muted-foreground text-sm">
          Sends through the saved connection, so this proves a reset email would actually arrive.
          Save your change first.
        </p>
        <div className="flex gap-2">
          <Input
            type="email"
            value={testTo}
            placeholder="you@example.com"
            onChange={(e) => setTestTo(e.target.value)}
            className="max-w-xs"
          />
          <Button
            type="button"
            variant="outline"
            onClick={sendTest}
            disabled={testing || !testTo.trim()}
          >
            {testing ? "Sending…" : "Send test email"}
          </Button>
        </div>
      </div>
    </div>
  );
}
