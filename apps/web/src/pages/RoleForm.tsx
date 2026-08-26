import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Role } from "../lib/types.js";
import { PERMISSION_CATEGORIES } from "../lib/permissions.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Input,
  Checkbox,
  CheckboxLabel,
  FormLabel,
  Alert,
  Skeleton,
  toast,
} from "../components/ui/index.js";

export default function RoleForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id !== undefined;

  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(!editing);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) return;
    api.get<Role>(`/roles/${id}`).then((r) => {
      if (r.id === 1) {
        toast.error("The Super Admin role can't be edited");
        navigate("/settings");
        return;
      }
      setName(r.name);
      setPermissions(r.permissions);
      setLoaded(true);
    });
  }, [id, editing, navigate]);

  function toggle(perm: string) {
    setPermissions((perms) =>
      perms.includes(perm) ? perms.filter((p) => p !== perm) : [...perms, perm],
    );
  }

  function toggleCategory(category: (typeof PERMISSION_CATEGORIES)[number], checked: boolean) {
    const values = category.permissions.map((p) => p.value);
    setPermissions((perms) =>
      checked ? [...new Set([...perms, ...values])] : perms.filter((p) => !values.includes(p)),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/roles/${id}`, { name, permissions });
        toast.success("Role updated");
      } else {
        await api.post("/roles", { name, permissions });
        toast.success("Role created");
      }
      navigate("/settings");
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <Skeleton className="h-64" />;

  return (
    <div>
      <PageHeaderWrapper variant="title-only" title={editing ? `Edit ${name}` : "New role"} />

      <BlockLayout>
        <form onSubmit={submit} className="space-y-4">
          <div className="max-w-sm space-y-2">
            <FormLabel required>Name</FormLabel>
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-4">
            <FormLabel>Permissions</FormLabel>
            {PERMISSION_CATEGORIES.map((category) => {
              const values = category.permissions.map((p) => p.value);
              const allChecked = values.every((v) => permissions.includes(v));
              return (
                <div key={category.resource} className="border-border rounded-md border p-3">
                  <div className="mb-2 flex items-center gap-1.5">
                    <Checkbox
                      checked={allChecked}
                      onCheckedChange={(v) => toggleCategory(category, v === true)}
                      id={`cat-${category.resource}`}
                    />
                    <CheckboxLabel htmlFor={`cat-${category.resource}`} className="font-medium">
                      {category.label}
                    </CheckboxLabel>
                  </div>
                  <div className="ml-6 space-y-1.5">
                    {category.permissions.map((p) => (
                      <div key={p.value} className="flex items-center gap-1.5">
                        <Checkbox
                          checked={permissions.includes(p.value)}
                          onCheckedChange={() => toggle(p.value)}
                          id={p.value}
                        />
                        <CheckboxLabel htmlFor={p.value}>{p.label}</CheckboxLabel>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {error && <Alert variant="destructive">{error}</Alert>}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create role"}
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
