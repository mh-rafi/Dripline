import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth.js";
import { Button, Input, FormLabel, Alert } from "../components/ui/index.js";

export default function Login() {
  const { login, setup } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "setup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "setup") {
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

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-[340px]">
        <div className="border-border bg-block-layout rounded-lg border p-6 shadow-sm">
          <h2 className="mb-1 text-xl font-medium">Dripline</h2>
          <p className="text-muted-foreground mb-4 text-sm">
            {mode === "setup" ? "Create the first admin account" : "Sign in"}
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "setup" && (
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
              {busy ? "..." : mode === "setup" ? "Create account" : "Sign in"}
            </Button>
          </form>
          <button
            type="button"
            onClick={() => setMode((m) => (m === "login" ? "setup" : "login"))}
            className="text-primary mt-4 text-xs hover:underline"
          >
            {mode === "setup" ? "I already have an account" : "First-time setup instead"}
          </button>
        </div>
      </div>
    </div>
  );
}
