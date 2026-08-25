import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth.js";
import Layout from "./components/Layout.js";
import Login from "./pages/Login.js";
import Unsubscribe from "./pages/Unsubscribe.js";
import Dashboard from "./pages/Dashboard.js";
import Subscribers from "./pages/Subscribers.js";
import SubscriberImport from "./pages/SubscriberImport.js";
import SubscriberDetail from "./pages/SubscriberDetail.js";
import Lists from "./pages/Lists.js";
import Templates from "./pages/Templates.js";
import Connections from "./pages/Connections.js";
import ConnectionForm from "./pages/ConnectionForm.js";
import Campaigns from "./pages/Campaigns.js";
import CampaignNew from "./pages/CampaignNew.js";
import CampaignDetail from "./pages/CampaignDetail.js";
import Automations from "./pages/Automations.js";
import AutomationBuilder from "./pages/AutomationBuilder.js";
import Settings from "./pages/Settings.js";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="text-muted-foreground flex min-h-screen items-center justify-center">
        Loading…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/unsubscribe/:campaignUuid/:subscriberUuid" element={<Unsubscribe />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/subscribers" element={<Subscribers />} />
        <Route path="/subscribers/import" element={<SubscriberImport />} />
        <Route path="/subscribers/:id" element={<SubscriberDetail />} />
        <Route path="/lists" element={<Lists />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/connections" element={<Connections />} />
        <Route path="/connections/new" element={<ConnectionForm />} />
        <Route path="/connections/:id" element={<ConnectionForm />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/campaigns/new" element={<CampaignNew />} />
        <Route path="/campaigns/:id" element={<CampaignDetail />} />
        <Route path="/automations" element={<Automations />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route
        path="/automations/:id"
        element={
          <RequireAuth>
            <AutomationBuilder />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
