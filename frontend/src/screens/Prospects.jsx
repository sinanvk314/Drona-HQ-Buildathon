import React from "react";
import Shell from "../components/shell/Shell.jsx";
import { useNav } from "../components/shell/NavContext.jsx";
import ProspectTable from "../components/features/ProspectTable.jsx";
import { useApi } from "../hooks/useApi.js";
import { getProspects } from "../services/api.js";

// Simple cross-campaign list that reuses the Campaign Detail prospect table.
export default function Prospects() {
  const { navigate } = useNav();
  const { data } = useApi(() => getProspects(), []);

  return (
    <Shell active="prospects" title="Prospects">
      <div className="card">
        <div style={{ padding: "18px 20px 4px 20px", fontSize: 14, fontWeight: 700 }}>
          All Prospects{data ? ` — ${data.length}` : ""}
        </div>
        {data && (
          <ProspectTable rows={data} showCampaign onOpen={(id) => navigate("prospect", { id })} emptyText="No prospects yet." />
        )}
      </div>
    </Shell>
  );
}
