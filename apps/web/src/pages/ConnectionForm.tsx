import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Alert,
  Skeleton,
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
  reply_to: string;
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
  bounce_enabled: boolean;
  bounce_use_sending_credentials: boolean;
  bounce_host: string;
  bounce_port: number;
  bounce_tls: boolean;
  bounce_username: string;
  bounce_password: string;
  bounce_email: string;
  bounce_folder: string;
  bounce_max_age_days: number;
  bounce_max_messages_per_scan: number;
}

const EMPTY_FORM: FormState = {
  name: "",
  type: "smtp",
  from_email: "",
  reply_to: "",
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
  bounce_enabled: false,
  bounce_use_sending_credentials: true,
  bounce_host: "",
  bounce_port: 993,
  bounce_tls: true,
  bounce_username: "",
  bounce_password: "",
  bounce_email: "",
  bounce_folder: "INBOX",
  bounce_max_age_days: 7,
  bounce_max_messages_per_scan: 200,
};

function formFromConnection(c: Connection): FormState {
  const cfg = c.config as Record<string, unknown>;
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    from_email: c.from_email,
    reply_to: c.reply_to ?? "",
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
    bounce_enabled: c.bounce_config?.enabled ?? false,
    bounce_use_sending_credentials: c.bounce_config?.use_sending_credentials ?? true,
    bounce_host: c.bounce_config?.host ?? "",
    bounce_port: c.bounce_config?.port ?? 993,
    bounce_tls: c.bounce_config?.tls ?? true,
    bounce_username: c.bounce_config?.use_sending_credentials
      ? ""
      : (c.bounce_config?.username ?? ""),
    bounce_password: "",
    bounce_email: c.bounce_config?.use_sending_credentials ? "" : (c.bounce_config?.email ?? ""),
    bounce_folder: c.bounce_config?.folder ?? "INBOX",
    bounce_max_age_days: c.bounce_config?.max_age_days ?? 7,
    bounce_max_messages_per_scan: c.bounce_config?.max_messages_per_scan ?? 200,
  };
}

function buildBounceConfig(form: FormState) {
  return {
    enabled: form.bounce_enabled,
    host: form.bounce_host,
    port: Number(form.bounce_port),
    tls: form.bounce_tls,
    use_sending_credentials: form.type === "ses" ? false : form.bounce_use_sending_credentials,
    username: form.bounce_use_sending_credentials ? undefined : form.bounce_username || undefined,
    password: form.bounce_use_sending_credentials ? undefined : form.bounce_password || undefined,
    email: form.bounce_use_sending_credentials ? undefined : form.bounce_email || undefined,
    folder: form.bounce_folder || "INBOX",
    max_age_days: Number(form.bounce_max_age_days),
    max_messages_per_scan: Number(form.bounce_max_messages_per_scan),
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

interface TestState {
  ok: boolean;
  error: string | null;
}

export default function ConnectionForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id !== undefined;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loaded, setLoaded] = useState(!editing);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestState | null>(null);
  const [bounceTesting, setBounceTesting] = useState(false);
  const [bounceTestResult, setBounceTestResult] = useState<TestState | null>(null);

  useEffect(() => {
    if (!editing) return;
    api.get<Connection>(`/connections/${id}`).then((c) => {
      setForm(formFromConnection(c));
      setLoaded(true);
    });
  }, [id, editing]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
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

  async function testBounceConnection() {
    setBounceTesting(true);
    setBounceTestResult(null);
    try {
      const result =
        form.id !== undefined
          ? await api.post<TestState>(`/connections/${form.id}/bounce-test`)
          : await api.post<TestState>("/connections/bounce-test", {
              type: form.type,
              config: buildConfig(form),
              bounce_config: buildBounceConfig(form),
            });
      setBounceTestResult(result);
    } catch (err) {
      setBounceTestResult({
        ok: false,
        error: err instanceof Error ? err.message : "test failed",
      });
    } finally {
      setBounceTesting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const config = buildConfig(form);
    const bounce_config = buildBounceConfig(form);
    const rate_limit_count = form.rate_limit_count ? Number(form.rate_limit_count) : null;
    const rate_limit_duration_seconds = form.rate_limit_duration_seconds;
    try {
      if (form.id !== undefined) {
        await api.patch(`/connections/${form.id}`, {
          name: form.name,
          from_email: form.from_email,
          from_name: form.from_name || undefined,
          reply_to: form.reply_to || null,
          rate_limit_count,
          rate_limit_duration_seconds,
          list_unsubscribe_header: form.list_unsubscribe_header,
          config,
          bounce_config,
        });
        toast.success("Connection updated");
      } else {
        await api.post("/connections", {
          name: form.name,
          type: form.type,
          from_email: form.from_email,
          from_name: form.from_name || undefined,
          reply_to: form.reply_to || null,
          rate_limit_count,
          rate_limit_duration_seconds,
          list_unsubscribe_header: form.list_unsubscribe_header,
          config,
          bounce_config,
        });
        toast.success("Connection created");
      }
      navigate("/connections");
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <Skeleton className="h-64" />;

  return (
    <div>
      <PageHeaderWrapper
        variant="title-only"
        title={editing ? `Edit ${form.name}` : "Add connection"}
      />

      <BlockLayout>
        <form onSubmit={submit} className="space-y-4">
          <Tabs defaultValue="sending">
            <TabsList>
              <TabsTrigger value="sending">Sending</TabsTrigger>
              <TabsTrigger value="bounce">Bounce mailbox</TabsTrigger>
            </TabsList>

            <TabsContent value="sending" className="space-y-4">
              <FormRow>
                <div className="space-y-2">
                  <FormLabel required>Name</FormLabel>
                  <Input required value={form.name} onChange={(e) => set("name", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <FormLabel>Type</FormLabel>
                  <Select
                    value={form.type}
                    onValueChange={(v) => set("type", v as ConnectionType)}
                    disabled={editing}
                  >
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
                  <Input
                    value={form.from_name}
                    onChange={(e) => set("from_name", e.target.value)}
                  />
                </div>
              </FormRow>

              <FormRow>
                <div className="space-y-2">
                  <FormLabel>Reply-To (optional)</FormLabel>
                  <Input
                    type="email"
                    value={form.reply_to}
                    onChange={(e) => set("reply_to", e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    Where replies go, if not the From address. A campaign can override it.
                  </p>
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
                The rate limit is enforced globally across every campaign/automation using this
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
                Gmail/Yahoo's bulk sender rules — leave this on unless you have a specific reason
                not to.
              </p>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testing}
                  onClick={testConnection}
                >
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
            </TabsContent>

            <TabsContent value="bounce" className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.bounce_enabled}
                  onCheckedChange={(v) => set("bounce_enabled", v === true)}
                />
                <span className="text-sm">Scan a mailbox for bounces</span>
              </div>
              <p className="text-muted-foreground text-xs">
                Periodically checks an IMAP mailbox for bounce messages and blocklists subscribers
                that hard-bounce — for providers that don't send bounce webhooks. Only fetches new
                mail since the last scan and never marks anything read, moved, or deleted.
              </p>

              {form.bounce_enabled && (
                <div className="border-border space-y-4 rounded-md border p-4">
                  {form.type === "smtp" && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={form.bounce_use_sending_credentials}
                        onCheckedChange={(v) => set("bounce_use_sending_credentials", v === true)}
                        id="bounce_use_sending"
                      />
                      <CheckboxLabel htmlFor="bounce_use_sending">
                        Scan this connection's own sending mailbox (reuse the username/password
                        above) — leave this on unless bounces go to a different mailbox
                      </CheckboxLabel>
                    </div>
                  )}

                  <FormRow>
                    <div className="space-y-2">
                      <FormLabel required>IMAP host</FormLabel>
                      <Input
                        required
                        value={form.bounce_host}
                        onChange={(e) => set("bounce_host", e.target.value)}
                        placeholder="e.g. imap.yourmailserver.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <FormLabel>Port</FormLabel>
                      <Input
                        type="number"
                        value={form.bounce_port}
                        onChange={(e) => set("bounce_port", Number(e.target.value))}
                      />
                    </div>
                  </FormRow>
                  <p className="text-muted-foreground text-xs">
                    The IMAP host is almost always different from the SMTP host, even for the same
                    mailbox — "use sending login" only reuses the username/password, not the server
                    address.
                  </p>

                  {!(form.type === "smtp" && form.bounce_use_sending_credentials) && (
                    <>
                      <FormRow>
                        <div className="space-y-2">
                          <FormLabel required>Username</FormLabel>
                          <Input
                            required
                            value={form.bounce_username}
                            onChange={(e) => {
                              const value = e.target.value;
                              set("bounce_username", value);
                              // Convenience only -- most providers use the
                              // email address as the IMAP login, so pre-fill
                              // the (separately editable) email field until
                              // the user changes it themselves. Never
                              // overwrites a value they've already set.
                              if (!form.bounce_email) set("bounce_email", value);
                            }}
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
                            required={!editing}
                            value={form.bounce_password}
                            onChange={(e) => set("bounce_password", e.target.value)}
                            placeholder={editing ? "••••••••" : ""}
                          />
                        </div>
                      </FormRow>

                      <div className="space-y-2">
                        <FormLabel required>Bounce email address</FormLabel>
                        <Input
                          type="email"
                          required
                          value={form.bounce_email}
                          onChange={(e) => set("bounce_email", e.target.value)}
                          placeholder="bounces@yourdomain.com"
                        />
                        <p className="text-muted-foreground text-xs">
                          The address bounces get sent to. Usually the same as the username above,
                          but not always — some providers log in with a plain username rather than
                          an email address.
                        </p>
                      </div>

                      <Alert>
                        Bounces will only actually arrive in this mailbox if this connection's
                        outgoing SMTP provider honors a custom envelope sender (Return-Path) — not
                        guaranteed for every provider. Send a test to a deliberately invalid address
                        afterward and confirm the bounce lands here.
                      </Alert>
                    </>
                  )}

                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={form.bounce_tls}
                      onCheckedChange={(v) => set("bounce_tls", v === true)}
                      id="bounce_tls"
                    />
                    <CheckboxLabel htmlFor="bounce_tls">Use TLS</CheckboxLabel>
                  </div>

                  <FormRow>
                    <div className="space-y-2">
                      <FormLabel>Folder</FormLabel>
                      <Input
                        value={form.bounce_folder}
                        onChange={(e) => set("bounce_folder", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <FormLabel>Only scan mail newer than (days)</FormLabel>
                      <Input
                        type="number"
                        min={1}
                        value={form.bounce_max_age_days}
                        onChange={(e) => set("bounce_max_age_days", Number(e.target.value))}
                      />
                    </div>
                  </FormRow>
                  <div className="space-y-2">
                    <FormLabel>Max messages per scan</FormLabel>
                    <Input
                      type="number"
                      min={1}
                      className="max-w-[160px]"
                      value={form.bounce_max_messages_per_scan}
                      onChange={(e) => set("bounce_max_messages_per_scan", Number(e.target.value))}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={bounceTesting}
                      onClick={testBounceConnection}
                    >
                      {bounceTesting ? "Testing…" : "Test bounce mailbox"}
                    </Button>
                    {bounceTestResult && (
                      <span
                        className={
                          bounceTestResult.ok ? "text-success text-sm" : "text-destructive text-sm"
                        }
                      >
                        {bounceTestResult.ok
                          ? "Mailbox reachable"
                          : `Failed: ${bounceTestResult.error}`}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>

          {error && <Alert variant="destructive">{error}</Alert>}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Save connection"}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate("/connections")}>
              Cancel
            </Button>
          </div>
        </form>
      </BlockLayout>
    </div>
  );
}
