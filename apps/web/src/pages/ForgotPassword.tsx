import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { Alert, Button, FormLabel, Input } from "../components/ui/index.js";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
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
          <h2 className="mb-1 text-xl font-medium">Reset your password</h2>
          {sent ? (
            <>
              {/* Deliberately says the same thing whether or not the address
                  has an account -- the API does too. */}
              <p className="text-muted-foreground mb-4 text-sm">
                If an account exists for {email}, a reset link is on its way. It expires in an hour.
              </p>
              <Button asChild className="w-full">
                <Link to="/login">Back to sign in</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground mb-4 text-sm">
                We will email you a link to choose a new one.
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <FormLabel required>Email</FormLabel>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                {error && <Alert variant="destructive">{error}</Alert>}
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "…" : "Send reset link"}
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
