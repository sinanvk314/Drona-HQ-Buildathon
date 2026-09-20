// Synthetic "Lead Research & Enrichment" discovery — a stand-in for a real Apollo/data-provider
// integration (PS's suggested tools list "Apollo or equivalent"; no external credentials are
// available in this build, so new prospects are generated from the campaign's own targeting
// criteria instead of fabricated at random). Swapping this module for a real Apollo API call
// needs no changes to the scheduler that calls it.
const FIRST = ["Jordan", "Priya", "Alex", "Maria", "Chen", "Sara", "Omar", "Elena", "Vikram", "Noah", "Ana", "Ravi"];
const LAST = ["Patel", "Kim", "Nguyen", "Silva", "Rao", "Fischer", "Diaz", "Novak", "Sharma", "Okoye", "Lund", "Iyer"];
const COMPANY_ROOTS = ["Cloudpeak", "Datalane", "Northgate", "Fleetstack", "Vertexa", "Brightloop", "Ironclad", "Skyforge", "Corevault", "Nimbusworks"];
const COMPANY_SUFFIX = ["Cloud", "Systems", "Labs", "Tech", "Data", "Networks"];

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[rand(0, arr.length - 1)];

function randomSizeWithin(range) {
  if (!range) return `${rand(20, 400)} employees`;
  return `${rand(range[0], range[1])} employees`;
}

function parseEmployeeRange(companyCriteria) {
  const m = /(\d{1,4})\s*[–-]\s*(\d{1,4})\s*employees/.exec(companyCriteria || "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

let seq = 0;

/** Generates one plausible new prospect for a campaign, biased toward the campaign's own ICP so it's a realistic mix of fits and misses. */
export function generateProspect(campaign) {
  seq += 1;
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  const company = `${pick(COMPANY_ROOTS)}${pick(COMPANY_SUFFIX)}`;
  const persona = campaign.personas?.length ? pick(campaign.personas) : "Founder";
  const onIcp = Math.random() < 0.65; // most discovered leads are roughly on-target; some aren't
  const range = parseEmployeeRange(campaign.companyCriteria);
  const size = onIcp ? randomSizeWithin(range) : `${rand(1, 8)} employees`;
  const funding = pick(["Seed, $2M raised", "Series A, $12M raised", "Series B, $30M raised", "Pre-seed"]);
  const city = campaign.geography?.includes("India") ? pick(["Mumbai, IN", "Bengaluru, IN", "Pune, IN"]) : pick(["Austin, TX", "New York, NY", "Denver, CO", "Seattle, WA"]);

  return {
    id: `p_gen_${Date.now()}_${seq}`,
    campaignId: campaign.id,
    name,
    title: onIcp ? persona : "Marketing Manager",
    company,
    email: `${name.split(" ")[0].toLowerCase()}@${company.toLowerCase().replace(/\s+/g, "")}.com`,
    city,
    linkedin: `linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "")}`,
    industry: pick(["SaaS", "Fintech", "DevOps", "Voice AI", "Data infrastructure"]),
    size,
    funding,
    tech: onIcp ? [pick(["AWS", "GCP", "Azure"]), "Kubernetes"] : [pick(["AWS", "GCP"])],
    stage: "researched",
    fit: null,
    channel: "—",
    lastAction: "Enriched, {ago}",
    lastTs: Date.now(),
    nextStep: "ICP scoring",
    reasons: ["Awaiting ICP scoring"],
    evidence: ["Enriched from an approved company database"],
    qual: { status: "Pending", reasoning: "Research complete; waiting for the ICP Fitment Agent.", agent: "Lead Research Agent", harness: "harness v2.0", ts: Date.now() },
    history: [{ kind: "chat", text: "Research record completed by Lead Research Agent", when: "Today" }],
    conversation: [],
    touches: [],
    plan: null,
    nextTouchTs: null,
  };
}
