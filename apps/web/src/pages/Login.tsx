import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth.js";

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
    <div className="center-screen">
      <div className="card auth-box">
        <h2 style={{ marginTop: 0 }}>Dripline</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          {mode === "setup" ? "Create the first admin account" : "Sign in"}
        </p>
        <form onSubmit={handleSubmit}>
          {mode === "setup" && (
            <>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </>
          )}
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {error && <p className="error-text">{error}</p>}
          <div style={{ marginTop: 20 }}>
            <button type="submit" disabled={busy} style={{ width: "100%" }}>
              {mode === "setup" ? "Create account" : "Sign in"}
            </button>
          </div>
        </form>
        <p style={{ fontSize: 12, marginTop: 16 }}>
          <button
            type="button"
            className="secondary"
            style={{ padding: "4px 8px", fontSize: 12 }}
            onClick={() => setMode((m) => (m === "login" ? "setup" : "login"))}
          >
            {mode === "setup" ? "I already have an account" : "First-time setup instead"}
          </button>
        </p>
      </div>
    </div>
  );
}
