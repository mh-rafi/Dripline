import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { Button, Input, FormLabel, Alert } from "../components/ui/index.js";

export default function Login() {
  const { login, setup } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "setup">("login");
  // Starts false so the setup affordance is never flashed on an instance that
  // already has an account -- /meta only ever turns it on.
  const [setupRequired, setSetupRequired] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ setup_required: boolean }>("/meta")
      .then((meta) => setSetupRequired(meta.setup_required))
      .catch(() => setSetupRequired(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "setup" && setupRequired) {
        await setup(email, password, name);
      } else {
        await login(email, password);
      }
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const isSetup = mode === "setup" && setupRequired;

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-[340px]">
        <div className="border-border bg-block-layout rounded-lg border p-6 shadow-sm">
          <h2 className="mb-1 text-xl font-medium">Dripline</h2>
          <p className="text-muted-foreground mb-4 text-sm">
            {isSetup ? "Create the first admin account" : "Sign in"}
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            {isSetup && (
              <div className="space-y-2">
                <FormLabel>Name</FormLabel>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <FormLabel required>Email</FormLabel>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <FormLabel required>Password</FormLabel>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            {error && <Alert variant="destructive">{error}</Alert>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "..." : isSetup ? "Create account" : "Sign in"}
            </Button>
          </form>
          <div className="mt-4 flex items-center justify-between gap-3">
            {setupRequired ? (
              <button
                type="button"
                onClick={() => setMode((m) => (m === "login" ? "setup" : "login"))}
                className="text-primary text-xs hover:underline"
              >
                {isSetup ? "I already have an account" : "First-time setup instead"}
              </button>
            ) : (
              <span />
            )}
            {!isSetup && (
              <Link to="/forgot-password" className="text-muted-foreground text-xs hover:underline">
                Forgot password?
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
