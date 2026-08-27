import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { MediaSettings, Settings } from "../lib/types.js";
import {
  Alert,
  AlertDescription,
  Button,
  ButtonWithLoading,
  Checkbox,
  CheckboxLabel,
  FormLabel,
  FormMessage,
  FormRow,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Skeleton,
  Tag,
  toast,
} from "./ui/index.js";

/** Mirrors MASKED_SECRET in apps/api/src/services/settings.ts -- sending it
 * back unchanged is what tells the API to keep the stored key. */
const MASKED_SECRET = "••••••••";

function ExtensionsInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const next = draft
      .split(",")
      .map((e) => e.trim().toLowerCase().replace(/^\./, ""))
      .filter((e) => e && !value.includes(e));
    if (next.length) onChange([...value, ...next]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((ext) => (
          <Tag key={ext} onRemove={() => onChange(value.filter((e) => e !== ext))}>
            {ext}
          </Tag>
        ))}
        {value.length === 0 && (
          <span className="text-muted-foreground text-xs">No extensions allowed yet.</span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder="jpg, png, pdf …"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          className="max-w-xs"
        />
        <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

export default function MediaSettingsForm() {
  const [form, setForm] = useState<MediaSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api
      .get<Settings>("/settings")
      .then((s) => setForm(s.media))
      .catch((err) => toast.error(err instanceof Error ? err.message : "failed to load settings"));
  }, []);

  if (!form) return <Skeleton className="h-96 w-full" />;

  function set<K extends keyof MediaSettings>(key: K, value: MediaSettings[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }
  function setS3<K extends keyof MediaSettings["s3"]>(key: K, value: MediaSettings["s3"][K]) {
    setForm((f) => (f ? { ...f, s3: { ...f.s3, [key]: value } } : f));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const saved = await api.put<Settings>("/settings", { media: form });
      setForm(saved.media);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (!form) return;
    setTesting(true);
    try {
      await api.post("/settings/media/test", { media: form });
      toast.success("Connected to the bucket");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "connection failed");
    } finally {
      setTesting(false);
    }
  }

  const isAwsEndpoint = !form.s3.url || /amazonaws\.com/.test(form.s3.url);

  return (
    <form className="space-y-6" onSubmit={save}>
      <FormRow columns={2}>
        <div className="space-y-2">
          <FormLabel>Provider</FormLabel>
          <Select value={form.provider} onValueChange={(v) => set("provider", v as "s3")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="s3">S3 / S3-compatible</SelectItem>
            </SelectContent>
          </Select>
          <FormMessage>
            Works with AWS S3 and any S3-compatible store — MinIO, Cloudflare R2, DigitalOcean
            Spaces, Wasabi, Backblaze B2. Local filesystem storage is planned.
          </FormMessage>
        </div>
        <div className="space-y-2">
          <FormLabel>Maximum upload size (MB)</FormLabel>
          <Input
            type="number"
            min={1}
            value={form.max_size_mb}
            onChange={(e) => set("max_size_mb", Number(e.target.value))}
          />
        </div>
      </FormRow>

      <div className="space-y-2">
        <FormLabel>Permitted file extensions</FormLabel>
        <ExtensionsInput value={form.extensions} onChange={(v) => set("extensions", v)} />
        <FormMessage>
          Uploads are rejected unless the extension is listed here. Add <code>*</code> to allow
          everything.
        </FormMessage>
      </div>

      <hr className="border-border" />

      <FormRow columns={2}>
        <div className="space-y-2">
          <FormLabel>Region</FormLabel>
          <Input
            value={form.s3.region}
            placeholder="us-east-1"
            onChange={(e) => setS3("region", e.target.value)}
          />
          <FormMessage>
            Use &quot;auto&quot; for providers that don&apos;t have regions.
          </FormMessage>
        </div>
        <div className="space-y-2">
          <FormLabel>Bucket</FormLabel>
          <Input value={form.s3.bucket} onChange={(e) => setS3("bucket", e.target.value)} />
        </div>
      </FormRow>

      <FormRow columns={2}>
        <div className="space-y-2">
          <FormLabel>Access key ID</FormLabel>
          <Input
            value={form.s3.access_key_id}
            autoComplete="off"
            onChange={(e) => setS3("access_key_id", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <FormLabel>Secret access key</FormLabel>
          <Input
            type="password"
            value={form.s3.secret_access_key}
            autoComplete="new-password"
            onFocus={(e) => {
              // The stored key comes back masked; clear the mask on focus so
              // typing replaces it instead of appending to the dots.
              if (e.target.value === MASKED_SECRET) setS3("secret_access_key", "");
            }}
            onChange={(e) => setS3("secret_access_key", e.target.value)}
          />
          <FormMessage>Leave the masked value untouched to keep the saved key.</FormMessage>
        </div>
      </FormRow>

      <Alert variant="info">
        <AlertDescription>
          Leave both key fields empty to authenticate with the instance&apos;s IAM role instead.
        </AlertDescription>
      </Alert>

      <FormRow columns={2}>
        <div className="space-y-2">
          <FormLabel>Endpoint URL</FormLabel>
          <Input
            value={form.s3.url}
            placeholder={
              form.s3.region
                ? `https://s3.${form.s3.region}.amazonaws.com`
                : "https://s3.amazonaws.com"
            }
            onChange={(e) => setS3("url", e.target.value)}
          />
          <FormMessage>
            Leave blank for AWS (derived from the region). Set it for any other S3-compatible
            provider.
          </FormMessage>
        </div>
        <div className="space-y-2">
          <FormLabel>Bucket path</FormLabel>
          <Input
            value={form.s3.bucket_path}
            placeholder="/"
            onChange={(e) => setS3("bucket_path", e.target.value)}
          />
          <FormMessage>Optional prefix inside the bucket, eg. media/uploads.</FormMessage>
        </div>
      </FormRow>

      <FormRow columns={2}>
        <div className="space-y-2">
          <FormLabel>Bucket type</FormLabel>
          <Select
            value={form.s3.bucket_type}
            onValueChange={(v) => setS3("bucket_type", v as "public" | "private")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">Public — objects served directly</SelectItem>
              <SelectItem value="private">Private — pre-signed URLs</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {form.s3.bucket_type === "private" && (
          <div className="space-y-2">
            <FormLabel>Pre-signed URL expiry (seconds)</FormLabel>
            <Input
              type="number"
              min={1}
              max={604800}
              value={form.s3.expiry_seconds}
              onChange={(e) => setS3("expiry_seconds", Number(e.target.value))}
            />
            <FormMessage>S3 caps pre-signed URLs at 7 days (604800s).</FormMessage>
          </div>
        )}
      </FormRow>

      <div className="space-y-2">
        <FormLabel>Public URL</FormLabel>
        <Input
          value={form.s3.public_url}
          placeholder="https://files.yourdomain.com"
          onChange={(e) => setS3("public_url", e.target.value)}
        />
        <FormMessage>
          Optional CDN or custom domain the objects are served from. When set, it is used even for a
          private bucket — pre-signed URLs are skipped.
        </FormMessage>
      </div>

      <div className="space-y-2">
        <CheckboxLabel>
          <Checkbox
            checked={form.s3.force_path_style ?? !isAwsEndpoint}
            onCheckedChange={(v) => setS3("force_path_style", v === true)}
          />
          Use path-style URLs (endpoint/bucket/key)
        </CheckboxLabel>
        <FormMessage>
          Required by MinIO and most self-hosted gateways. AWS wants virtual-hosted style; the
          default follows the endpoint.
        </FormMessage>
      </div>

      <div className="flex gap-3">
        <ButtonWithLoading type="submit" loading={saving}>
          Save settings
        </ButtonWithLoading>
        <ButtonWithLoading type="button" variant="outline" loading={testing} onClick={test}>
          Test connection
        </ButtonWithLoading>
      </div>
    </form>
  );
}
