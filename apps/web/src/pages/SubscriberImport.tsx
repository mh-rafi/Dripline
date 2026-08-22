import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { parseCSV } from "../lib/csv.js";
import type { List } from "../lib/types.js";

type ColumnRole = "ignore" | "email" | "name" | "attribs_json" | "attribute";

interface ColumnMapping {
  index: number;
  header: string;
  role: ColumnRole;
  attributeKey: string;
}

function slugify(header: string): string {
  return (
    header
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field"
  );
}

function guessRole(header: string): ColumnRole {
  const h = header.trim().toLowerCase();
  if (h === "email" || h === "email address" || h.includes("email")) return "email";
  if (h === "name" || h === "full name") return "name";
  if (h === "attribs" || h === "attributes") return "attribs_json";
  return "attribute";
}

/** Only one column may claim each of these roles -- if the header-name
 * guessing produces two "email" (or name/attribs_json) columns, keep the
 * first and fall back the rest to "attribute" rather than silently
 * dropping their data. */
function dedupeSingletonRoles(cols: ColumnMapping[]): ColumnMapping[] {
  const seen = new Set<ColumnRole>();
  return cols.map((c) => {
    if (c.role === "email" || c.role === "name" || c.role === "attribs_json") {
      if (seen.has(c.role)) return { ...c, role: "attribute" as ColumnRole };
      seen.add(c.role);
    }
    return c;
  });
}

const BATCH_SIZE = 300;

export default function SubscriberImport() {
  const navigate = useNavigate();
  const [lists, setLists] = useState<List[]>([]);
  const [mode, setMode] = useState<"subscribe" | "blocklist">("subscribe");
  const [status, setStatus] = useState<"unconfirmed" | "confirmed">("confirmed");
  const [listIds, setListIds] = useState<number[]>([]);
  const [overwriteUserInfo, setOverwriteUserInfo] = useState(false);
  const [overwriteSubscriptionStatus, setOverwriteSubscriptionStatus] = useState(false);
  const [delimiter, setDelimiter] = useState(",");

  const [fileName, setFileName] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<List[]>("/lists").then(setLists);
  }, []);

  const parsed = useMemo(() => {
    if (!rawText) return null;
    const rows = parseCSV(rawText, delimiter || ",");
    const [headers, ...dataRows] = rows;
    if (!headers) return { headers: [], dataRows: [] };
    return { headers, dataRows };
  }, [rawText, delimiter]);

  useEffect(() => {
    if (!parsed) return;
    setMapping(
      dedupeSingletonRoles(
        parsed.headers.map((header, index) => ({
          index,
          header,
          role: guessRole(header),
          attributeKey: slugify(header),
        })),
      ),
    );
    setResult(null);
    setError(null);
  }, [parsed]);

  function loadFile(file: File) {
    setError(null);
    setResult(null);
    setFileName(file.name);
    file
      .text()
      .then(setRawText)
      .catch(() => setError("Could not read file."));
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  }

  function setRole(index: number, role: ColumnRole) {
    setMapping((cols) =>
      cols.map((c) => {
        if (c.index === index) return { ...c, role };
        if ((role === "email" || role === "name" || role === "attribs_json") && c.role === role) {
          return { ...c, role: "ignore" };
        }
        return c;
      }),
    );
  }

  function setAttributeKey(index: number, key: string) {
    setMapping((cols) => cols.map((c) => (c.index === index ? { ...c, attributeKey: key } : c)));
  }

  const emailColumn = mapping.find((c) => c.role === "email");

  function buildSubscriber(
    row: string[],
  ): { email: string; name?: string; attribs?: Record<string, unknown> } | null {
    if (!emailColumn) return null;
    const email = row[emailColumn.index]?.trim();
    if (!email) return null;

    const nameColumn = mapping.find((c) => c.role === "name");
    const name = nameColumn ? row[nameColumn.index]?.trim() : undefined;

    const attribs: Record<string, unknown> = {};
    const jsonColumn = mapping.find((c) => c.role === "attribs_json");
    if (jsonColumn) {
      const raw = row[jsonColumn.index]?.trim();
      if (raw) {
        try {
          Object.assign(attribs, JSON.parse(raw));
        } catch {
          // Malformed JSON for this one row -- drop just the attributes, not the whole row.
        }
      }
    }
    for (const c of mapping) {
      if (c.role === "attribute" && c.attributeKey) {
        const value = row[c.index]?.trim();
        if (value) attribs[c.attributeKey] = value;
      }
    }

    return {
      email,
      name: name || undefined,
      attribs: Object.keys(attribs).length ? attribs : undefined,
    };
  }

  async function runImport() {
    if (!parsed || !emailColumn) {
      setError("Map one column to Email before importing.");
      return;
    }
    if (mode === "subscribe" && listIds.length === 0) {
      setError("Select at least one list, or switch to Blocklist mode.");
      return;
    }

    const subscribers = parsed.dataRows
      .map(buildSubscriber)
      .filter((s): s is NonNullable<typeof s> => s !== null);
    const skipped = parsed.dataRows.length - subscribers.length;

    setImporting(true);
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: subscribers.length });

    let imported = 0;
    try {
      for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
        const batch = subscribers.slice(i, i + BATCH_SIZE);
        const res = await api.post<{ imported: number }>("/subscribers/import", {
          mode,
          status,
          list_ids: mode === "subscribe" ? listIds : [],
          overwrite_user_info: overwriteUserInfo,
          overwrite_subscription_status: overwriteSubscriptionStatus,
          subscribers: batch,
        });
        imported += res.imported;
        setProgress({
          done: Math.min(i + BATCH_SIZE, subscribers.length),
          total: subscribers.length,
        });
      }
      setResult({ imported, skipped });
    } catch (err) {
      setError(err instanceof Error ? err.message : "import failed");
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Import subscribers</h2>
        <button className="secondary" onClick={() => navigate("/subscribers")}>
          Back
        </button>
      </div>

      <div className="card">
        <div className="form-row">
          <div>
            <label>Mode</label>
            <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
              <label
                style={{ display: "flex", alignItems: "center", gap: 6, width: "auto", margin: 0 }}
              >
                <input
                  type="radio"
                  style={{ width: "auto" }}
                  checked={mode === "subscribe"}
                  onChange={() => setMode("subscribe")}
                />
                Subscribe
              </label>
              <label
                style={{ display: "flex", alignItems: "center", gap: 6, width: "auto", margin: 0 }}
              >
                <input
                  type="radio"
                  style={{ width: "auto" }}
                  checked={mode === "blocklist"}
                  onChange={() => setMode("blocklist")}
                />
                Blocklist
              </label>
            </div>
          </div>
          <div>
            <label>Status</label>
            <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
              <label
                style={{ display: "flex", alignItems: "center", gap: 6, width: "auto", margin: 0 }}
              >
                <input
                  type="radio"
                  style={{ width: "auto" }}
                  disabled={mode === "blocklist"}
                  checked={status === "unconfirmed"}
                  onChange={() => setStatus("unconfirmed")}
                />
                Unconfirmed
              </label>
              <label
                style={{ display: "flex", alignItems: "center", gap: 6, width: "auto", margin: 0 }}
              >
                <input
                  type="radio"
                  style={{ width: "auto" }}
                  disabled={mode === "blocklist"}
                  checked={status === "confirmed"}
                  onChange={() => setStatus("confirmed")}
                />
                Confirmed
              </label>
            </div>
          </div>
          <div>
            <label>CSV delimiter</label>
            <input
              value={delimiter}
              onChange={(e) => setDelimiter(e.target.value.slice(0, 1) || ",")}
              maxLength={1}
              style={{ maxWidth: 60 }}
            />
            <p className="muted" style={{ fontSize: 12 }}>
              Default delimiter is comma.
            </p>
          </div>
        </div>

        <div className="form-row">
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="switch">
              <input
                type="checkbox"
                checked={overwriteUserInfo}
                onChange={(e) => setOverwriteUserInfo(e.target.checked)}
              />
              <span className="slider" />
            </span>
            Overwrite user info
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="switch">
              <input
                type="checkbox"
                checked={overwriteSubscriptionStatus}
                onChange={(e) => setOverwriteSubscriptionStatus(e.target.checked)}
                disabled={mode === "blocklist"}
              />
              <span className="slider" />
            </span>
            Overwrite subscription status
          </label>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Overwrite name and attributes of existing subscribers / overwrite the status of existing
          list subscriptions. Off by default -- existing data is left alone.
        </p>

        {mode === "subscribe" && (
          <>
            <label>Lists</label>
            <select
              multiple
              value={listIds.map(String)}
              onChange={(e) =>
                setListIds(Array.from(e.target.selectedOptions, (o) => Number(o.value)))
              }
              size={Math.min(Math.max(lists.length, 3), 8)}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.optin})
                </option>
              ))}
            </select>
            {lists.length === 0 && <p className="muted">No lists yet.</p>}
          </>
        )}

        <label>CSV file</label>
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          style={{
            border: "1px dashed var(--border)",
            borderRadius: 8,
            padding: 32,
            textAlign: "center",
            cursor: "pointer",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={onFileInputChange}
          />
          {fileName ? (
            <span>{fileName} -- click or drop to replace</span>
          ) : (
            <span className="muted">Click or drag a CSV file here</span>
          )}
        </div>
      </div>

      {parsed && parsed.headers.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Map columns</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            {parsed.dataRows.length} row{parsed.dataRows.length === 1 ? "" : "s"} detected. Choose
            what each CSV column means -- exactly one column must map to Email.
          </p>
          <table>
            <thead>
              <tr>
                <th>CSV column</th>
                <th>Sample value</th>
                <th>Maps to</th>
                <th>Attribute key</th>
              </tr>
            </thead>
            <tbody>
              {mapping.map((c) => (
                <tr key={c.index}>
                  <td>{c.header || <span className="muted">(column {c.index + 1})</span>}</td>
                  <td className="muted">{parsed.dataRows[0]?.[c.index] ?? ""}</td>
                  <td>
                    <select
                      value={c.role}
                      onChange={(e) => setRole(c.index, e.target.value as ColumnRole)}
                    >
                      <option value="ignore">Ignore</option>
                      <option value="email">Email</option>
                      <option value="name">Name</option>
                      <option value="attribs_json">Attributes (JSON)</option>
                      <option value="attribute">Attribute</option>
                    </select>
                  </td>
                  <td>
                    {c.role === "attribute" ? (
                      <input
                        value={c.attributeKey}
                        onChange={(e) => setAttributeKey(c.index, e.target.value)}
                      />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {error && <p className="error-text">{error}</p>}
          {progress && (
            <p className="muted">
              Importing… {progress.done}/{progress.total}
            </p>
          )}
          {result && (
            <p style={{ color: "var(--success)" }}>
              Imported {result.imported} subscriber{result.imported === 1 ? "" : "s"}
              {result.skipped > 0
                ? `, skipped ${result.skipped} row${result.skipped === 1 ? "" : "s"} without a valid email`
                : ""}
              .
            </p>
          )}

          <div style={{ marginTop: 16 }}>
            <button onClick={runImport} disabled={importing || !emailColumn}>
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
