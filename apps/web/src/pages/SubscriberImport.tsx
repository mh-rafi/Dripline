import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { parseCSV } from "../lib/csv.js";
import type { List } from "../lib/types.js";
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
  RadioGroup,
  RadioGroupItem,
  RadioGroupLabel,
  Switch,
  FormLabel,
  FormRow,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Alert,
  Typography,
} from "../components/ui/index.js";

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

type FixedAttributeType = "text" | "number" | "boolean" | "json";
type AttribsMode = "merge" | "replace" | "skip";

interface FixedAttribute {
  id: number;
  key: string;
  value: string;
  type: FixedAttributeType;
}

/** Returns `null` when the raw text doesn't parse as the chosen type. */
function parseFixedValue(attr: FixedAttribute): { value: unknown } | null {
  switch (attr.type) {
    case "number": {
      const trimmed = attr.value.trim();
      const n = Number(trimmed);
      return trimmed && Number.isFinite(n) ? { value: n } : null;
    }
    case "boolean":
      return { value: attr.value === "true" };
    case "json":
      try {
        return { value: JSON.parse(attr.value) as unknown };
      } catch {
        return null;
      }
    default:
      return { value: attr.value };
  }
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
  const [attribsMode, setAttribsMode] = useState<AttribsMode>("merge");
  const [fixedAttribs, setFixedAttribs] = useState<FixedAttribute[]>([]);
  const nextFixedId = useRef(1);
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

  function addFixedAttribute() {
    setFixedAttribs((rows) => [
      ...rows,
      { id: nextFixedId.current++, key: "", value: "", type: "text" },
    ]);
  }

  function updateFixedAttribute(id: number, patch: Partial<Omit<FixedAttribute, "id">>) {
    setFixedAttribs((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeFixedAttribute(id: number) {
    setFixedAttribs((rows) => rows.filter((r) => r.id !== id));
  }

  const invalidFixedAttribs = fixedAttribs.filter((f) => f.key.trim() && !parseFixedValue(f));

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
    // Applied last so an import-wide value wins over whatever the file says.
    for (const fa of fixedAttribs) {
      const key = fa.key.trim();
      if (!key) continue;
      const parsedValue = parseFixedValue(fa);
      if (parsedValue) attribs[key] = parsedValue.value;
    }

    return {
      email,
      name: name || undefined,
      attribs: Object.keys(attribs).length ? attribs : undefined,
    };
  }

  const previewAttribs =
    parsed && emailColumn && parsed.dataRows[0]
      ? (buildSubscriber(parsed.dataRows[0])?.attribs ?? null)
      : null;

  async function runImport() {
    if (!parsed || !emailColumn) {
      setError("Map one column to Email before importing.");
      return;
    }
    if (mode === "subscribe" && listIds.length === 0) {
      setError("Select at least one list, or switch to Blocklist mode.");
      return;
    }
    if (invalidFixedAttribs.length > 0) {
      setError("Every fixed attribute needs a value matching its type.");
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
          attribs_mode: attribsMode,
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
      <PageHeaderWrapper
        variant="title-with-actions"
        title="Import subscribers"
        actions={
          <Button variant="outline" onClick={() => navigate("/subscribers")}>
            Back
          </Button>
        }
      />

      <BlockLayout className="mb-4">
        <div className="space-y-4">
          <FormRow>
            <div className="space-y-2">
              <FormLabel>Mode</FormLabel>
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as "subscribe" | "blocklist")}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="subscribe" id="mode-subscribe" />
                  <RadioGroupLabel htmlFor="mode-subscribe">Subscribe</RadioGroupLabel>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="blocklist" id="mode-blocklist" />
                  <RadioGroupLabel htmlFor="mode-blocklist">Blocklist</RadioGroupLabel>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <FormLabel>Status</FormLabel>
              <RadioGroup
                value={status}
                onValueChange={(v) => setStatus(v as "unconfirmed" | "confirmed")}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="unconfirmed"
                    id="status-unconfirmed"
                    disabled={mode === "blocklist"}
                  />
                  <RadioGroupLabel htmlFor="status-unconfirmed">Unconfirmed</RadioGroupLabel>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="confirmed"
                    id="status-confirmed"
                    disabled={mode === "blocklist"}
                  />
                  <RadioGroupLabel htmlFor="status-confirmed">Confirmed</RadioGroupLabel>
                </div>
              </RadioGroup>
            </div>
          </FormRow>

          <div className="space-y-2">
            <FormLabel>CSV delimiter</FormLabel>
            <Input
              value={delimiter}
              onChange={(e) => setDelimiter(e.target.value.slice(0, 1) || ",")}
              maxLength={1}
              className="max-w-[60px]"
            />
            <p className="text-muted-foreground text-xs">Default delimiter is comma.</p>
          </div>

          <FormRow>
            <div className="flex items-center gap-3">
              <Switch checked={overwriteUserInfo} onCheckedChange={setOverwriteUserInfo} />
              <span className="text-sm">Overwrite name</span>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={overwriteSubscriptionStatus}
                onCheckedChange={setOverwriteSubscriptionStatus}
                disabled={mode === "blocklist"}
              />
              <span className="text-sm">Overwrite subscription status</span>
            </div>
          </FormRow>
          <p className="text-muted-foreground text-xs">
            Overwrite the name of an existing subscriber / overwrite the status of an existing list
            subscription. Off by default — existing data is left alone.
          </p>

          <div className="space-y-2">
            <FormLabel>Attributes of existing subscribers</FormLabel>
            <Select value={attribsMode} onValueChange={(v) => setAttribsMode(v as AttribsMode)}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="merge">Merge</SelectItem>
                <SelectItem value="replace">Replace</SelectItem>
                <SelectItem value="skip">Leave alone</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Merge adds and updates only the imported keys and keeps every other attribute. Replace
              swaps the whole attributes object, which also discards tags. Leave alone imports
              nothing into the attributes of subscribers who already exist.
            </p>
          </div>

          {mode === "subscribe" && (
            <div className="space-y-2">
              <FormLabel>Lists</FormLabel>
              <select
                multiple
                value={listIds.map(String)}
                onChange={(e) =>
                  setListIds(Array.from(e.target.selectedOptions, (o) => Number(o.value)))
                }
                size={Math.min(Math.max(lists.length, 3), 8)}
                className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.optin})
                  </option>
                ))}
              </select>
              {lists.length === 0 && <p className="text-muted-foreground text-sm">No lists yet.</p>}
            </div>
          )}

          <div className="space-y-2">
            <FormLabel>CSV file</FormLabel>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className="border-input hover:bg-accent/50 cursor-pointer rounded-lg border border-dashed p-8 text-center"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={onFileInputChange}
              />
              {fileName ? (
                <span className="text-sm">{fileName} — click or drop to replace</span>
              ) : (
                <span className="text-muted-foreground text-sm">Click or drag a CSV file here</span>
              )}
            </div>
          </div>
        </div>
      </BlockLayout>

      {parsed && parsed.headers.length > 0 && (
        <BlockLayout className="mb-4">
          <div className="space-y-4">
            <Typography variant="h3">Map columns</Typography>
            <p className="text-muted-foreground text-sm">
              {parsed.dataRows.length} row{parsed.dataRows.length === 1 ? "" : "s"} detected. Choose
              what each CSV column means — exactly one column must map to Email.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CSV column</TableHead>
                  <TableHead>Sample value</TableHead>
                  <TableHead>Maps to</TableHead>
                  <TableHead>Attribute key</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mapping.map((c) => (
                  <TableRow key={c.index}>
                    <TableCell>
                      {c.header || (
                        <span className="text-muted-foreground">(column {c.index + 1})</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {parsed.dataRows[0]?.[c.index] ?? ""}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={c.role}
                        onValueChange={(v) => setRole(c.index, v as ColumnRole)}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ignore">Ignore</SelectItem>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="name">Name</SelectItem>
                          <SelectItem value="attribs_json">Attributes (JSON)</SelectItem>
                          <SelectItem value="attribute">Attribute</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {c.role === "attribute" ? (
                        <Input
                          value={c.attributeKey}
                          onChange={(e) => setAttributeKey(c.index, e.target.value)}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="space-y-3">
              <Typography variant="h3">Fixed attributes</Typography>
              <p className="text-muted-foreground text-sm">
                Added to every imported row on top of anything mapped from the CSV — useful for
                stamping a whole file with where it came from, e.g. <code>product</code> ={" "}
                <code>Mentor LMS</code>. A fixed attribute wins over a CSV column of the same key.
              </p>
              {fixedAttribs.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fixedAttribs.map((fa) => (
                      <TableRow key={fa.id}>
                        <TableCell>
                          <Input
                            value={fa.key}
                            placeholder="product"
                            onChange={(e) => updateFixedAttribute(fa.id, { key: e.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={fa.type}
                            onValueChange={(v) =>
                              updateFixedAttribute(fa.id, {
                                type: v as FixedAttributeType,
                                ...(v === "boolean" && fa.value !== "false"
                                  ? { value: "true" }
                                  : {}),
                              })
                            }
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">Text</SelectItem>
                              <SelectItem value="number">Number</SelectItem>
                              <SelectItem value="boolean">Boolean</SelectItem>
                              <SelectItem value="json">JSON</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {fa.type === "boolean" ? (
                            <Select
                              value={fa.value === "false" ? "false" : "true"}
                              onValueChange={(v) => updateFixedAttribute(fa.id, { value: v })}
                            >
                              <SelectTrigger className="w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="true">True</SelectItem>
                                <SelectItem value="false">False</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              value={fa.value}
                              placeholder={fa.type === "json" ? '["vip","2026"]' : "Mentor LMS"}
                              onChange={(e) =>
                                updateFixedAttribute(fa.id, { value: e.target.value })
                              }
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm-icon"
                            tooltip="Remove"
                            onClick={() => removeFixedAttribute(fa.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Button variant="outline" size="sm" onClick={addFixedAttribute}>
                <Plus className="mr-1 h-4 w-4" />
                Add fixed attribute
              </Button>
              {invalidFixedAttribs.length > 0 && (
                <Alert variant="destructive">
                  These fixed attributes do not parse as their chosen type:{" "}
                  {invalidFixedAttribs.map((f) => f.key.trim()).join(", ")}.
                </Alert>
              )}
            </div>

            {previewAttribs && (
              <div className="space-y-2">
                <FormLabel>Attributes preview (first row)</FormLabel>
                <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
                  {JSON.stringify(previewAttribs, null, 2)}
                </pre>
                <p className="text-muted-foreground text-xs">
                  {attribsMode === "merge"
                    ? "Merged into the existing attributes of subscribers already in the database."
                    : attribsMode === "replace"
                      ? "Replaces the entire attributes object of subscribers already in the database."
                      : "Applied to new subscribers only."}
                </p>
              </div>
            )}

            {error && <Alert variant="destructive">{error}</Alert>}
            {progress && (
              <p className="text-muted-foreground text-sm">
                Importing… {progress.done}/{progress.total}
              </p>
            )}
            {result && (
              <p className="text-success text-sm">
                Imported {result.imported} subscriber{result.imported === 1 ? "" : "s"}
                {result.skipped > 0
                  ? `, skipped ${result.skipped} row${result.skipped === 1 ? "" : "s"} without a valid email`
                  : ""}
                .
              </p>
            )}

            <Button onClick={runImport} disabled={importing || !emailColumn}>
              {importing ? "Importing…" : "Import"}
            </Button>
          </div>
        </BlockLayout>
      )}
    </div>
  );
}
