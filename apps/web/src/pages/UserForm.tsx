import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Role, User, UserStatus, UserType, UserWithToken } from "../lib/types.js";
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
  Switch,
  FormLabel,
  FormRow,
  Alert,
  Skeleton,
  toast,
} from "../components/ui/index.js";

interface FormState {
  type: UserType;
  name: string;
  email: string;
  password: string;
  role_id: string;
  status: UserStatus;
}

const EMPTY_FORM: FormState = {
  type: "user",
  name: "",
  email: "",
  password: "",
  role_id: "",
  status: "enabled",
};

function formFromUser(u: User): FormState {
  return {
    type: u.type,
    name: u.name,
    email: u.email ?? "",
    password: "",
    role_id: String(u.role_id),
    status: u.status,
  };
}

export default function UserForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id !== undefined;

  const [roles, setRoles] = useState<Role[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loaded, setLoaded] = useState(!editing);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  useEffect(() => {
    api.get<Role[]>("/roles").then(setRoles);
  }, []);

  useEffect(() => {
    if (!editing) return;
    api.get<User>(`/users/${id}`).then((u) => {
      setForm(formFromUser(u));
      setLoaded(true);
    });
  }, [id, editing]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/users/${id}`, {
          name: form.name,
          ...(form.type === "user" ? { email: form.email } : {}),
          ...(form.type === "user" && form.password ? { password: form.password } : {}),
          role_id: Number(form.role_id),
          status: form.status,
        });
        toast.success("User updated");
        navigate("/settings");
      } else if (form.type === "user") {
        await api.post("/users", {
          type: "user",
          name: form.name,
          email: form.email,
          password: form.password,
          role_id: Number(form.role_id),
          status: form.status,
        });
        toast.success("User created");
        navigate("/settings");
      } else {
        const created = await api.post<UserWithToken>("/users", {
          type: "api",
          name: form.name,
          role_id: Number(form.role_id),
          status: form.status,
        });
        setRevealedToken(created.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function regenerateToken() {
    if (!id) return;
    setRegenerating(true);
    try {
      const result = await api.post<UserWithToken>(`/users/${id}/regenerate-token`);
      setRevealedToken(result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to regenerate token");
    } finally {
      setRegenerating(false);
    }
  }

  if (!loaded) return <Skeleton className="h-64" />;

  return (
    <div>
      <PageHeaderWrapper variant="title-only" title={editing ? `Edit ${form.name}` : "New user"} />

      <BlockLayout>
        {revealedToken && (
          <Alert variant="warning" className="mb-4">
            <div>
              <strong>Copy this token now — it won't be shown again:</strong>
              <pre className="bg-muted mt-2 overflow-auto rounded-md p-2 font-mono text-sm">
                {revealedToken}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setRevealedToken(null);
                  navigate("/settings");
                }}
              >
                Done
              </Button>
            </div>
          </Alert>
        )}

        <form onSubmit={submit} className="space-y-4">
          <FormRow>
            <div className="space-y-2">
              <FormLabel>Type</FormLabel>
              <Select
                value={form.type}
                onValueChange={(v) => set("type", v as UserType)}
                disabled={editing}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User (email + password login)</SelectItem>
                  <SelectItem value="api">API (token-based access)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <FormLabel required>Name</FormLabel>
              <Input required value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
          </FormRow>

          {form.type === "user" && (
            <FormRow>
              <div className="space-y-2">
                <FormLabel required>Email</FormLabel>
                <Input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
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
                  minLength={8}
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder={editing ? "••••••••" : ""}
                />
              </div>
            </FormRow>
          )}

          <FormRow>
            <div className="space-y-2">
              <FormLabel required>Role</FormLabel>
              <Select value={form.role_id} onValueChange={(v) => set("role_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <FormLabel>Status</FormLabel>
              <div className="flex items-center gap-3 pt-2">
                <Switch
                  checked={form.status === "enabled"}
                  onCheckedChange={(v) => set("status", v ? "enabled" : "disabled")}
                />
                <span className="text-sm">
                  {form.status === "enabled" ? "Enabled" : "Disabled"}
                </span>
              </div>
            </div>
          </FormRow>

          {editing && form.type === "api" && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={regenerating}
                onClick={regenerateToken}
              >
                {regenerating ? "Regenerating…" : "Regenerate token"}
              </Button>
              <span className="text-muted-foreground text-xs">
                Invalidates the current token immediately.
              </span>
            </div>
          )}

          {error && <Alert variant="destructive">{error}</Alert>}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={saving || !form.role_id}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create user"}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate("/settings")}>
              Cancel
            </Button>
          </div>
        </form>
      </BlockLayout>
    </div>
  );
}
