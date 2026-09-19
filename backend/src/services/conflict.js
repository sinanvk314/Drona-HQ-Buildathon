// Campaign Isolation & Conflict Handling (PS Section 3): before any campaign makes first
// contact with a prospect, check whether another campaign has already contacted the same
// person (matched by email, which is unique per person across the whole prospect pool) within
// the suppression window. Real check — not hardcoded — so it fires for any prospect, not just
// the one seeded demo case.
const CONTACT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // "one campaign per prospect within 14 days"

/**
 * @returns {{ ok: boolean, text: string, blockingCampaignId?: string }}
 */
export function checkConflict(state, prospect, now = Date.now()) {
  if (!prospect.email) return { ok: true, text: "No conflicts found" };

  const others = state.prospects.filter(
    (p) => p.id !== prospect.id && p.email && p.email.toLowerCase() === prospect.email.toLowerCase() && p.campaignId !== prospect.campaignId
  );

  for (const other of others) {
    const contactedRecently = other.lastTs && now - other.lastTs < CONTACT_WINDOW_MS && other.stage !== "researched" && other.stage !== "discovered";
    if (contactedRecently) {
      const otherCampaign = state.campaigns.find((c) => c.id === other.campaignId);
      const hours = Math.max(1, Math.round((now - other.lastTs) / (60 * 60 * 1000)));
      return {
        ok: false,
        text: `Conflict found — already contacted by ${otherCampaign ? otherCampaign.name : "another campaign"} ${hours}h ago`,
        blockingCampaignId: other.campaignId,
      };
    }
  }

  // Also respect the global suppression / do-not-contact list (exact email or domain wildcard).
  const domain = prospect.email.split("@")[1] || "";
  const suppressed = state.suppression.some((s) => {
    const c = s.contact.toLowerCase();
    if (c === prospect.email.toLowerCase()) return true;
    if (c.startsWith("*@")) return c.slice(2) === domain.toLowerCase();
    return c === domain.toLowerCase();
  });
  if (suppressed) return { ok: false, text: "Conflict found — contact or domain is on the suppression list" };

  return { ok: true, text: "No conflicts found" };
}
