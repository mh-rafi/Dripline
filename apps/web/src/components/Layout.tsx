import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth.js";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/subscribers", label: "Subscribers" },
  { to: "/lists", label: "Lists" },
  { to: "/templates", label: "Templates" },
  { to: "/campaigns", label: "Campaigns" },
  { to: "/workflows", label: "Workflows" },
  { to: "/providers", label: "Providers" },
  { to: "/settings", label: "Settings" },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Dripline</h1>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}>
            {l.label}
          </NavLink>
        ))}
        <div style={{ marginTop: "auto", paddingTop: 20 }}>
          <div className="muted" style={{ fontSize: 12, padding: "0 8px 8px" }}>
            {user?.email}
          </div>
          <button className="secondary" style={{ width: "100%" }} onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
