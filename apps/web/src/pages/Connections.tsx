import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { AuthMethod, Connection, ConnectionType, TlsMode } from "../lib/types.js";
import DurationInput from "../components/DurationInput.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Checkbox,
  CheckboxLabel,
  Switch,
  FormLabel,
  FormRow,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  Popconfirm,
  Alert,
  toast,
} from "../components/ui/index.js";

const TLS_MODES: TlsMode[] = ["none", "starttls", "tls"];
const AUTH_METHODS: AuthMethod[] = ["none", "login", "plain", "cram-md5"];

interface FormState {
  id?: number;
  name: string;
  type: ConnectionType;
  from_email: string;
  from_name: string;
  host: string;
  port: number;
  tls_mode: TlsMode;
  tls_skip_verify: boolean;
  auth_method: AuthMethod;
  username: string;
  password: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  use_iam_role: boolean;
  rate_limit_count: string;
  rate_limit_duration_seconds: number | null;
  list_unsubscribe_header: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  type: "smtp",
  from_email: "",
  from_name: "",
  host: "",
  port: 587,
  tls_mode: "starttls",
  tls_skip_verify: false,
  auth_method: "login",
  username: "",
  password: "",
  region: "us-east-1",
  access_key_id: "",
  secret_access_key: "",
  use_iam_role: false,
  rate_limit_count: "",
  rate_limit_duration_seconds: null,
  list_unsubscribe_header: true,
};

function formFromConnection(c: Connection): FormState {
  const cfg = c.config as Record<string, unknown>;
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    from_email: c.from_email,
    from_name: c.from_name,
    host: (cfg.host as string) ?? "",
    port: (cfg.port as number) ?? 587,
    tls_mode: (cfg.tls_mode as TlsMode) ?? "starttls",
    tls_skip_verify: (cfg.tls_skip_verify as boolean) ?? false,
    auth_method: (cfg.auth_method as AuthMethod) ?? "login",
    username: (cfg.username as string) ?? "",
    password: "",
    region: (cfg.region as string) ?? "us-east-1",
    access_key_id: (cfg.access_key_id as string) ?? "",
    secret_access_key: "",
    use_iam_role: (cfg.use_iam_role as boolean) ?? false,
    rate_limit_count: c.rate_limit_count ? String(c.rate_limit_count) : "",
    rate_limit_duration_seconds: c.rate_limit_duration_seconds ?? null,
    list_unsubscribe_header: c.list_unsubscribe_header,
  };
}

function buildConfig(form: FormState): Record<string, unknown> {
  if (form.type === "ses") {
    return {
      region: form.region,
      access_key_id: form.access_key_id || undefined,
      secret_access_key: form.secret_access_key || undefined,
      use_iam_role: form.use_iam_role,
    };
  }
  return {
    host: form.host,
    port: Number(form.port),
    tls_mode: form.tls_mode,
    tls_skip_verify: form.tls_skip_verify,
    auth_method: form.auth_method,
    username: form.username || undefined,
    password: form.password || undefined,
  };
}

function configSummary(c: Connection): string {
  const cfg = c.config as Record<string, unknown>;
  if (c.type === "ses") return `SES · ${cfg.region ?? "?"}`;
  return `SMTP · ${cfg.host ?? "?"}:${cfg.port ?? "?"}`;
}

function rateLimitSummary(c: Connection): string {
  if (!c.rate_limit_count || !c.rate_limit_duration_seconds) return "unlimited";
  const mins = Math.round(c.rate_limit_duration_seconds / 60);
  return `${c.rate_limit_count} / ${mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`}`;
}

interface TestState {
  ok: boolean;
  error: string | null;
}

export default function Connections() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestState | null>(null);

  function load() {
    api.get<Connection[]>("/connections").then(setConnections);
  }
  useEffect(load, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startAdd() {
    setForm(EMPTY_FORM);
    setTestResult(null);
    setError(null);
    setShowForm(true);
  }

  function startEdit(c: Connection) {
    setForm(formFromConnection(c));
    setTestResult(null);
    setError(null);
    setShowForm(true);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const result =
        form.id !== undefined
          ? await api.post<TestState>(`/connections/${form.id}/test`)
          : await api.post<TestState>("/connections/test", {
              type: form.type,
              config: buildConfig(form),
            });
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : "test failed",
      });
    } finally {
      setTesting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const config = buildConfig(form);
    const rate_limit_count = form.rate_limit_count ? Number(form.rate_limit_count) : null;
    const rate_limit_duration_seconds = form.rate_limit_duration_seconds;
    try {
      if (form.id !== undefined) {
        await api.patch(`/connections/${form.id}`, {
          name: form.name,
          from_email: form.from_email,
          from_name: form.from_name || undefined,
          rate_limit_count,
          rate_limit_duration_seconds,
          list_unsubscribe_header: form.list_unsubscribe_header,
          config,
        });
        toast.success("Connection updated");
      } else {
        await api.post("/connections", {
          name: form.name,
          type: form.type,
          from_email: form.from_email,
          from_name: form.from_name || undefined,
          rate_limit_count,
          rate_limit_duration_seconds,
          list_unsubscribe_header: form.list_unsubscribe_header,
          config,
        });
        toast.success("Connection created");
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    }
  }

  async function toggleEnable(c: Connection) {
    if (c.enabled) {
      await api.patch(`/connections/${c.id}`, { enabled: false });
    } else {
      await api.post(`/connections/${c.id}/enable`);
    }
    load();
  }

  async function remove(id: number) {
    await api.delete(`/connections/${id}`);
    load();
    toast.success("Connection deleted");
  }

  const editing = form.id !== undefined;

  return (
    <div>
      <PageHeaderWrapper
        variant="title-with-actions"
        title="Sending connections"
        actions={
          <Button onClick={() => (showForm ? setShowForm(false) : startAdd())}>
            {showForm ? "Cancel" : "Add connection"}
          </Button>
        }
      />

      <p className="text-muted-foreground mb-6 text-sm">
        Each connection is a distinct sending identity (SMTP or AWS SES). Campaigns and automation
        steps pick a primary connection and optional ordered fallbacks — there is no automatic pool,
        so each site's mail stays on its own domain.
      </p>

      {showForm && (
        <BlockLayout className="mb-6">
          <form onSubmit={submit} className="space-y-4">
            <FormRow>
              <div className="space-y-2">
                <FormLabel required>Name</FormLabel>
                <Input required value={form.name} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div className="space-y-2">
                <FormLabel>Type</FormLabel>
                <Select value={form.type} onValueChange={(v) => set("type", v as ConnectionType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="smtp">SMTP</SelectItem>
                    <SelectItem value="ses">AWS SES</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </FormRow>

            <FormRow>
              <div className="space-y-2">
                <FormLabel required>From email</FormLabel>
                <Input
                  type="email"
                  required
                  value={form.from_email}
                  onChange={(e) => set("from_email", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <FormLabel>From name (optional)</FormLabel>
                <Input value={form.from_name} onChange={(e) => set("from_name", e.target.value)} />
              </div>
            </FormRow>

            {form.type === "smtp" ? (
              <>
                <FormRow>
                  <div className="space-y-2">
                    <FormLabel required>SMTP host</FormLabel>
                    <Input
                      required
                      value={form.host}
                      onChange={(e) => set("host", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <FormLabel>Port</FormLabel>
                    <Input
                      type="number"
                      value={form.port}
                      onChange={(e) => set("port", Number(e.target.value))}
                    />
                  </div>
                </FormRow>

                <FormRow>
                  <div className="space-y-2">
                    <FormLabel>TLS mode</FormLabel>
                    <Select
                      value={form.tls_mode}
                      onValueChange={(v) => set("tls_mode", v as TlsMode)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TLS_MODES.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m === "none"
                              ? "None (no encryption)"
                              : m === "starttls"
                                ? "STARTTLS"
                                : "SSL/TLS (implicit)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <FormLabel>Auth method</FormLabel>
                    <Select
                      value={form.auth_method}
                      onValueChange={(v) => set("auth_method", v as AuthMethod)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AUTH_METHODS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </FormRow>

                <FormRow>
                  <div className="space-y-2">
                    <FormLabel>Username</FormLabel>
                    <Input
                      value={form.username}
                      onChange={(e) => set("username", e.target.value)}
                      disabled={form.auth_method === "none"}
                    />
                  </div>
                  <div className="space-y-2">
                    <FormLabel>
                      Password{" "}
                      {editing && (
                        <span className="text-muted-foreground font-normal">
                          (leave blank to keep current)
                        </span>
                      )}
                    </FormLabel>
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(e) => set("password", e.target.value)}
                      placeholder={editing ? "••••••••" : ""}
                      disabled={form.auth_method === "none"}
                    />
                  </div>
                </FormRow>

                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={form.tls_skip_verify}
                    onCheckedChange={(v) => set("tls_skip_verify", v === true)}
                    id="tls_skip"
                  />
                  <CheckboxLabel htmlFor="tls_skip">
                    Skip TLS certificate verification
                  </CheckboxLabel>
                </div>
              </>
            ) : (
              <>
                <FormRow>
                  <div className="space-y-2">
                    <FormLabel required>AWS region</FormLabel>
                    <Input
                      required
                      value={form.region}
                      onChange={(e) => set("region", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <FormLabel>Access key ID</FormLabel>
                    <Input
                      value={form.access_key_id}
                      onChange={(e) => set("access_key_id", e.target.value)}
                      disabled={form.use_iam_role}
                    />
                  </div>
                </FormRow>
                <div className="space-y-2">
                  <FormLabel>
                    Secret access key{" "}
                    {editing && (
                      <span className="text-muted-foreground font-normal">
                        (leave blank to keep current)
                      </span>
                    )}
                  </FormLabel>
                  <Input
                    type="password"
                    value={form.secret_access_key}
                    onChange={(e) => set("secret_access_key", e.target.value)}
                    placeholder={editing ? "••••••••" : ""}
                    disabled={form.use_iam_role}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={form.use_iam_role}
                    onCheckedChange={(v) => set("use_iam_role", v === true)}
                    id="iam_role"
                  />
                  <CheckboxLabel htmlFor="iam_role">
                    Use ambient IAM / instance role (no static keys)
                  </CheckboxLabel>
                </div>
              </>
            )}

            <FormRow>
              <div className="space-y-2">
                <FormLabel>Rate limit — count (blank = unlimited)</FormLabel>
                <Input
                  type="number"
                  min={1}
                  value={form.rate_limit_count}
                  onChange={(e) => set("rate_limit_count", e.target.value)}
                  placeholder="e.g. 100"
                />
              </div>
              <div className="space-y-2">
                <FormLabel>Rate limit — window</FormLabel>
                <DurationInput
                  key={form.id ?? "new"}
                  seconds={form.rate_limit_duration_seconds}
                  onChange={(s) => set("rate_limit_duration_seconds", s)}
                  placeholder="e.g. 15"
                />
              </div>
            </FormRow>
            <p className="text-muted-foreground text-xs">
              The rate limit is enforced globally across every campaign/workflow using this
              connection. Optional campaign throttling can only slow a send down further.
            </p>

            <div className="flex items-center gap-3">
              <Switch
                checked={form.list_unsubscribe_header}
                onCheckedChange={(v) => set("list_unsubscribe_header", v === true)}
              />
              <span className="text-sm">Send List-Unsubscribe header</span>
            </div>
            <p className="text-muted-foreground text-xs">
              Adds a one-click unsubscribe header to every email sent through this connection, on
              top of the unsubscribe link in the body. Improves inbox placement and is required by
              Gmail/Yahoo's bulk sender rules — leave this on unless you have a specific reason not
              to.
            </p>

            <div className="flex items-center gap-2">
              <Button type="submit">{editing ? "Save changes" : "Save connection"}</Button>
              <Button type="button" variant="outline" disabled={testing} onClick={testConnection}>
                {testing ? "Testing…" : "Test connection"}
              </Button>
              {testResult && (
                <span
                  className={testResult.ok ? "text-success text-sm" : "text-destructive text-sm"}
                >
                  {testResult.ok ? "Connection OK" : `Failed: ${testResult.error}`}
                </span>
              )}
            </div>
            {error && <Alert variant="destructive">{error}</Alert>}
          </form>
        </BlockLayout>
      )}

      <BlockLayout padding="sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Rate limit</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{configSummary(c)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {c.from_name ? `${c.from_name} <${c.from_email}>` : c.from_email}
                </TableCell>
                <TableCell className="text-muted-foreground">{rateLimitSummary(c)}</TableCell>
                <TableCell>
                  {c.enabled ? (
                    <span className="bg-success/15 text-success inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                      enabled
                    </span>
                  ) : (
                    <span
                      className="bg-destructive/15 text-destructive inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                      title={c.disabled_reason ?? ""}
                    >
                      disabled
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => startEdit(c)}>
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => toggleEnable(c)}>
                      {c.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Popconfirm
                      description="Delete this connection?"
                      onConfirm={() => remove(c.id)}
                      confirmText="Delete"
                    >
                      <Button variant="outline" size="sm">
                        Delete
                      </Button>
                    </Popconfirm>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {connections.length === 0 && (
          <TableEmptyState
            title="No connections configured"
            description="Campaigns can't send until at least one is added."
          />
        )}
      </BlockLayout>
    </div>
  );
}
