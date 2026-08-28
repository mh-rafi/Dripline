import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { Alert, Button, FormLabel, Input } from "../components/ui/index.js";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/reset-password", { token, password });
      setDone(true);
      // The reset invalidates every existing session for the account, so the
      // only way forward is a fresh sign-in.
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-[340px]">
        <div className="border-border bg-block-layout rounded-lg border p-6 shadow-sm">
          <h2 className="mb-1 text-xl font-medium">Choose a new password</h2>
          {!token ? (
            <>
              <p className="text-muted-foreground mb-4 text-sm">
                This link is missing its token. Request a new one.
              </p>
              <Button asChild className="w-full">
                <Link to="/forgot-password">Request a reset link</Link>
              </Button>
            </>
          ) : done ? (
            <>
              <p className="text-muted-foreground mb-4 text-sm">
                Password updated. Sending you to the sign-in page…
              </p>
              <Button asChild className="w-full">
                <Link to="/login">Sign in</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground mb-4 text-sm">
                Signing in anywhere else will need this new password.
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <FormLabel required>New password</FormLabel>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <FormLabel required>Confirm new password</FormLabel>
                  <Input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                {error && <Alert variant="destructive">{error}</Alert>}
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "…" : "Set new password"}
                </Button>
              </form>
              <Link
                to="/login"
                className="text-muted-foreground mt-4 inline-block text-xs hover:underline"
              >
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
