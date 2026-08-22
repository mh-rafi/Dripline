import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { AuthMethod, Connection, ConnectionType, TlsMode } from "../lib/types.js";
import DurationInput from "../components/DurationInput.js";

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
      // For an existing row that hasn't been re-saved, test the persisted
      // config (the real secret isn't available client-side). For a new draft,
      // test the form values directly.
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
          config,
        });
      } else {
        await api.post("/connections", {
          name: form.name,
          type: form.type,
          from_email: form.from_email,
          from_name: form.from_name || undefined,
          rate_limit_count,
          rate_limit_duration_seconds,
          config,
        });
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
    if (!confirm("Delete this connection?")) return;
    await api.delete(`/connections/${id}`);
    load();
  }

  const editing = form.id !== undefined;

  return (
    <div>
      <div className="page-header">
        <h2>Sending connections</h2>
        <button onClick={() => (showForm ? setShowForm(false) : startAdd())}>
          {showForm ? "Cancel" : "Add connection"}
        </button>
      </div>

      <p className="muted">
        Each connection is a distinct sending identity (SMTP or AWS SES). Campaigns and automation
        steps pick a primary connection and optional ordered fallbacks — there is no automatic pool,
        so each site's mail stays on its own domain.
      </p>

      {showForm && (
        <form className="card" onSubmit={submit}>
          <div className="form-row">
            <div>
              <label>Name</label>
              <input required value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div>
              <label>Type</label>
              <select
                value={form.type}
                onChange={(e) => set("type", e.target.value as ConnectionType)}
              >
                <option value="smtp">SMTP</option>
                <option value="ses">AWS SES</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div>
              <label>From email</label>
              <input
                type="email"
                required
                value={form.from_email}
                onChange={(e) => set("from_email", e.target.value)}
              />
            </div>
            <div>
              <label>From name (optional)</label>
              <input value={form.from_name} onChange={(e) => set("from_name", e.target.value)} />
            </div>
          </div>

          {form.type === "smtp" ? (
            <>
              <div className="form-row">
                <div>
                  <label>SMTP host</label>
                  <input required value={form.host} onChange={(e) => set("host", e.target.value)} />
                </div>
                <div>
                  <label>Port</label>
                  <input
                    type="number"
                    value={form.port}
                    onChange={(e) => set("port", Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label>TLS mode</label>
                  <select
                    value={form.tls_mode}
                    onChange={(e) => set("tls_mode", e.target.value as TlsMode)}
                  >
                    {TLS_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m === "none"
                          ? "None (no encryption)"
                          : m === "starttls"
                            ? "STARTTLS"
                            : "SSL/TLS (implicit)"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Auth method</label>
                  <select
                    value={form.auth_method}
                    onChange={(e) => set("auth_method", e.target.value as AuthMethod)}
                  >
                    {AUTH_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label>Username</label>
                  <input
                    value={form.username}
                    onChange={(e) => set("username", e.target.value)}
                    disabled={form.auth_method === "none"}
                  />
                </div>
                <div>
                  <label>
                    Password{" "}
                    {editing && <span className="muted">(leave blank to keep current)</span>}
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                    placeholder={editing ? "••••••••" : ""}
                    disabled={form.auth_method === "none"}
                  />
                </div>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={form.tls_skip_verify}
                  onChange={(e) => set("tls_skip_verify", e.target.checked)}
                />
                Skip TLS certificate verification
              </label>
            </>
          ) : (
            <>
              <div className="form-row">
                <div>
                  <label>AWS region</label>
                  <input
                    required
                    value={form.region}
                    onChange={(e) => set("region", e.target.value)}
                  />
                </div>
                <div>
                  <label>Access key ID</label>
                  <input
                    value={form.access_key_id}
                    onChange={(e) => set("access_key_id", e.target.value)}
                    disabled={form.use_iam_role}
                  />
                </div>
              </div>
              <label>
                Secret access key{" "}
                {editing && <span className="muted">(leave blank to keep current)</span>}
              </label>
              <input
                type="password"
                value={form.secret_access_key}
                onChange={(e) => set("secret_access_key", e.target.value)}
                placeholder={editing ? "••••••••" : ""}
                disabled={form.use_iam_role}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={form.use_iam_role}
                  onChange={(e) => set("use_iam_role", e.target.checked)}
                />
                Use ambient IAM / instance role (no static keys)
              </label>
            </>
          )}

          <div className="form-row" style={{ marginTop: 16 }}>
            <div>
              <label>Rate limit — count (blank = unlimited)</label>
              <input
                type="number"
                min={1}
                value={form.rate_limit_count}
                onChange={(e) => set("rate_limit_count", e.target.value)}
                placeholder="e.g. 100"
              />
            </div>
            <div>
              <label>Rate limit — window</label>
              <DurationInput
                key={form.id ?? "new"}
                seconds={form.rate_limit_duration_seconds}
                onChange={(s) => set("rate_limit_duration_seconds", s)}
                placeholder="e.g. 15"
              />
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            The rate limit is enforced globally across every campaign/workflow using this
            connection. Optional campaign throttling can only slow a send down further.
          </p>

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="submit">{editing ? "Save changes" : "Save connection"}</button>
            <button type="button" className="secondary" disabled={testing} onClick={testConnection}>
              {testing ? "Testing…" : "Test connection"}
            </button>
            {testResult && (
              <span
                style={{
                  color: testResult.ok ? "var(--success)" : "var(--danger, #c00)",
                  fontSize: 13,
                }}
              >
                {testResult.ok ? "Connection OK" : `Failed: ${testResult.error}`}
              </span>
            )}
          </div>
          {error && <p className="error-text">{error}</p>}
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>From</th>
            <th>Rate limit</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {connections.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td className="muted">{configSummary(c)}</td>
              <td className="muted">
                {c.from_name ? `${c.from_name} <${c.from_email}>` : c.from_email}
              </td>
              <td className="muted">{rateLimitSummary(c)}</td>
              <td>
                {c.enabled ? (
                  <span className="badge running">enabled</span>
                ) : (
                  <span className="badge cancelled" title={c.disabled_reason ?? ""}>
                    disabled
                  </span>
                )}
              </td>
              <td className="toolbar" style={{ marginBottom: 0 }}>
                <button className="secondary" onClick={() => startEdit(c)}>
                  Edit
                </button>
                <button className="secondary" onClick={() => toggleEnable(c)}>
                  {c.enabled ? "Disable" : "Enable"}
                </button>
                <button className="secondary" onClick={() => remove(c.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {connections.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No connections configured — campaigns can't send until at least one is added.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
