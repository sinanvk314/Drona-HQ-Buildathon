// The one place a prospect object is made, whoever found them: the generator, the imitated people search, or a person
// typing details in. Every prospect says where it came from (`source`), so a manager can always tell real from simulated.
//
// Prospects are people at organisations, not only companies: `company` holds the organisation's name (a company, a
// college, a club), and anything else worth knowing goes in `attributes` (for example the college a student leads a club at).

let counter = 0;

/**
 * @param fields  name, title, company (the organisation), email, city, industry, size, funding, tech[], attributes{}, linkedin
 * @param source  { provider, real, note }: provider is a label such as "imitated search" or "entered by a person";
 *                real is true only for data a person supplied or a real data source returned
 */
export function newProspect(campaign, fields, source, now = Date.now()) {
  counter += 1;
  const name = String(fields.name || "Unnamed").trim();
  const org = String(fields.company || "").trim();
  return {
    id: `p_gen_${now}_${counter}`,
    campaignId: campaign.id,
    name,
    title: fields.title || "",
    company: org,
    email: fields.email || `${name.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "")}@${org.toLowerCase().replace(/[^a-z0-9]+/g, "") || "unknown"}.example`,
    city: fields.city || "",
    linkedin: fields.linkedin || "",
    industry: fields.industry || "",
    size: fields.size || "",
    funding: fields.funding || "",
    tech: Array.isArray(fields.tech) ? fields.tech : [],
    attributes: fields.attributes && typeof fields.attributes === "object" ? fields.attributes : {},
    source: { provider: source.provider, real: !!source.real, note: source.note || "" },
    stage: "discovered",
    fit: null,
    channel: "—",
    lastAction: "Found, {ago}",
    lastTs: now,
    nextStep: "Research",
    reasons: ["Awaiting ICP scoring"],
    evidence: [],
    qual: { status: "Pending", reasoning: "Found; waiting for research and the ICP Fitment Agent.", agent: "Lead Research Agent", harness: "n/a", ts: now },
    history: [{ kind: "chat", text: `Found by ${source.provider}`, when: "Today" }],
    conversation: [],
    touches: [],
    plan: null,
    nextTouchTs: null,
    dossier: { facts: [], notes: [], hooks: [], gaps: [] },
  };
}
