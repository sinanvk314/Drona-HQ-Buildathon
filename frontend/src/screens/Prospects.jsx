import React, { useState } from "react";
import Shell from "../components/shell/Shell.jsx";
import { useNav } from "../components/shell/NavContext.jsx";
import ProspectTable from "../components/features/ProspectTable.jsx";
import { useApi } from "../hooks/useApi.js";
import { getProspects } from "../services/api.js";

// Simple cross-campaign list that reuses the Campaign Detail prospect table.
export default function Prospects() {
  const { navigate } = useNav();
  const [includeClosed, setIncludeClosed] = useState(false);
  const { data } = useApi(() => getProspects({ includeClosed }), [includeClosed]);

  return (
    <Shell active="prospects" title="Prospects">
      <div className="card">
        <div style={{ padding: "18px 20px 4px 20px", fontSize: 15, fontWeight: 700 }}>
          {includeClosed ? "All Prospects" : "Prospects in active campaigns"}{data ? ` - ${data.length}` : ""}
          <label style={{ fontSize: 12.5, fontWeight: 400, marginLeft: 16, color: "var(--text-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} style={{ marginRight: 6 }} />
            Include completed and archived campaigns
          </label>
        </div>
        {data && (
          <ProspectTable rows={data} showCampaign onOpen={(id) => navigate("prospect", { id })} emptyText="No prospects yet." />
        )}
      </div>
    </Shell>
  );
}
