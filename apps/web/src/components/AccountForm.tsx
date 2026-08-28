import { useState } from "react";
import { api, setToken } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { Alert, ButtonWithLoading, FormLabel, Input, Typography, toast } from "./ui/index.js";

export default function AccountForm() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError("The two new passwords do not match.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Changing the password invalidates every token issued before it, this
      // tab's included -- the API hands back a replacement so the person who
      // just changed their own password isn't signed out for doing so.
      const res = await api.post<{ token: string }>("/auth/password", {
        current_password: current,
        new_password: next,
      });
      setToken(res.token);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Password changed — other sessions have been signed out");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to change password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <div className="space-y-2">
        <Typography variant="h3">Profile</Typography>
        <dl className="text-sm">
          <div className="flex justify-between py-1">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{user?.name || "—"}</dd>
          </div>
          <div className="flex justify-between py-1">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{user?.email || "—"}</dd>
          </div>
          <div className="flex justify-between py-1">
            <dt className="text-muted-foreground">Role</dt>
            <dd>{user?.role_name}</dd>
          </div>
        </dl>
      </div>

      <form onSubmit={save} className="space-y-4">
        <Typography variant="h3">Change password</Typography>
        <div className="space-y-2">
          <FormLabel required>Current password</FormLabel>
          <Input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <div className="space-y-2">
          <FormLabel required>New password</FormLabel>
          <Input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <p className="text-muted-foreground text-xs">At least 8 characters.</p>
        </div>
        <div className="space-y-2">
          <FormLabel required>Confirm new password</FormLabel>
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        {error && <Alert variant="destructive">{error}</Alert>}
        <ButtonWithLoading type="submit" loading={saving}>
          Change password
        </ButtonWithLoading>
      </form>
    </div>
  );
}
