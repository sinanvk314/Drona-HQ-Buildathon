import React, { useCallback, useEffect, useMemo, useState } from "react";
import { NavContext } from "./components/shell/NavContext.jsx";
import { ToastProvider } from "./components/ui/Toast.jsx";
import { startActivitySimulation } from "./services/api.js";
import CommandCenter from "./screens/CommandCenter.jsx";
import CreateCampaign from "./screens/CreateCampaign.jsx";
import CampaignDetail from "./screens/CampaignDetail.jsx";
import Prospects from "./screens/Prospects.jsx";
import ProspectDetail from "./screens/ProspectDetail.jsx";
import DecisionJournal from "./screens/DecisionJournal.jsx";
import Approvals from "./screens/Approvals.jsx";
import AgentsPrompts from "./screens/AgentsPrompts.jsx";
import Settings from "./screens/Settings.jsx";
import Reps from "./screens/Reps.jsx";
import Compare from "./screens/Compare.jsx";
import Login from "./screens/Login.jsx";
import { useSession } from "./hooks/useSession.js";

const SCREENS = {
  command: CommandCenter,
  campaigns: CommandCenter,
  createCampaign: CreateCampaign,
  editCampaign: CreateCampaign,
  campaignDetail: CampaignDetail,
  prospects: Prospects,
  prospect: ProspectDetail,
  journal: DecisionJournal,
  approvals: Approvals,
  agents: AgentsPrompts,
  reps: Reps,
  analytics: Compare,
  settings: Settings,
};

const ROUTE_KEY = "sdr-control-plane-route-v1";

function loadRoute() {
  try {
    const r = JSON.parse(window.sessionStorage.getItem(ROUTE_KEY));
    if (r && r.name && SCREENS[r.name]) return r;
  } catch (e) {
    // fall through to the default route
  }
  return { name: "command", params: {} };
}

export default function App() {
  const session = useSession();
  const [route, setRoute] = useState(loadRoute);

  const navigate = useCallback((name, params = {}) => {
    const next = { name, params };
    try {
      window.sessionStorage.setItem(ROUTE_KEY, JSON.stringify(next));
    } catch (e) {
      // ignore storage errors
    }
    setRoute(next);
  }, []);

  useEffect(() => startActivitySimulation(), []);

  const value = useMemo(() => ({ route, navigate }), [route, navigate]);
  const Screen = SCREENS[route.name] || CommandCenter;

  if (!session) return <ToastProvider><Login /></ToastProvider>;

  return (
    <ToastProvider>
      <NavContext.Provider value={value}>
        <Screen key={`${route.name}:${JSON.stringify(route.params)}`} routeName={route.name} params={route.params} />
      </NavContext.Provider>
    </ToastProvider>
  );
}
