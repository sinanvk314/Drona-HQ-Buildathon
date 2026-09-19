import { useToast } from "../components/ui/Toast.jsx";
import { launchCampaign, pauseCampaign, resumeCampaign } from "../services/api.js";

// Pause / Resume / Launch for a single campaign. The service layer scopes the change to that campaign only.
export function useCampaignActions() {
  const toast = useToast();
  return async (id, action) => {
    try {
      if (action === "pause") await pauseCampaign(id);
      else if (action === "resume") await resumeCampaign(id);
      else if (action === "launch") await launchCampaign(id);
    } catch (e) {
      toast(e.message, "error");
    }
  };
}

export const ACTION_LABEL = { pause: "Pause", resume: "Resume", launch: "Launch" };
