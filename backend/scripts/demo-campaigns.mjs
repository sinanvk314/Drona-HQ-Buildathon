// Sets up a demo: archives every existing campaign and launches three demo-ready ones, each with its own offer, audience,
// knowledge, voice, reps and approval level, so a demonstration shows three different campaigns running at once.
//
//   node backend\scripts\demo-campaigns.mjs https://your-app.onrender.com            (shows the plan, changes nothing)
//   node backend\scripts\demo-campaigns.mjs https://your-app.onrender.com --yes      (does it)
//
// There is no hard delete in the app: "archive" removes a campaign from every screen and keeps its data. If the site has an
// access code, give it in the DEMO_ACCESS_CODE environment variable. All three campaigns use simulated data.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://localhost:8080").replace(/\/+$/, "");
const yes = args.includes("--yes");

const HOURS = "9:00 AM – 6:00 PM";

export const DEMO = [
  {
    values: {
      name: "SaaS Cloud Cost Reviews: US CTOs",
      description: "Offers a free cloud cost review to engineering leaders at growing US software companies.",
      owner: "Demo team",
      objective: "Book a 30-minute cloud cost review call with a CTO or VP of Engineering",
      offer:
        "A free 30-minute cloud cost review. We look at how a team's cloud bill is split across services and environments, point out the three biggest sources of waste, and send a short written summary afterwards. It is free, there is nothing to install, and it does not need access to production systems.",
      brief:
        "You are an SDR for a small team that helps software companies control their cloud spend. You write to engineering leaders as one engineer to another: specific, calm and brief, never like a marketer. You only mention what is in the offer and the knowledge. You never quote a price, promise savings, or claim a certification. The goal is one thing: a short call.",
      mode: "bulk", sourcing: "simulated-search", audienceKind: "organisations",
      icpText: "CTOs and VPs of Engineering at B2B software companies with about 50 to 500 employees, based in the United States, who run their product on a public cloud and are growing.",
      geography: ["United States"], personas: ["CTO", "VP Engineering"],
      companyCriteria: "B2B software company, 50 to 500 employees, runs on a public cloud",
      exclusionCriteria: "Companies under 20 employees, consultancies and agencies, and cloud providers themselves",
      channels: ["email", "linkedin"],
      qualificationPrompt:
        "Qualify when the person leads engineering or technology at a B2B software company of roughly 50 to 500 employees in the United States, and the company plausibly spends meaningfully on cloud infrastructure. A score of 75 or above qualifies. Reject agencies, consultancies, cloud providers and companies clearly outside the size range.",
      dailyLimit: 40, workingHours: HOURS, cadence: { maxTouches: 3, waitHours: 72 },
      approvals: { firstOutreach: true, meetingTime: false, escalate: true, level: "manual" },
      sources: [
        { name: "What the cloud cost review includes", category: "Product", content: "The cloud cost review is a free 30-minute call with one of our engineers.\n\nWe ask the team to talk us through their main cloud services and environments. We then show how the bill is split across production, staging and development, and point out the three biggest sources of waste we can see.\n\nAfter the call we send a short written summary of what we found. There is nothing to install, and we do not need access to production systems." },
        { name: "Where cloud spend usually goes to waste", category: "Product", content: "Teams commonly find spend they did not intend in a few places: environments left running outside working hours, oversized instances chosen early and never revisited, storage that keeps growing because nothing expires it, and data transfer between regions.\n\nThe review looks at these areas first because they are usually the quickest to understand and to fix." },
      ],
    },
    persona: { tone: "calm, specific and brief; one engineer writing to another", signOff: "" },
  },
  {
    values: {
      name: "Campus Innovation Workshops: India",
      description: "Invites faculty advisors and student club leaders at Indian engineering colleges to host a free innovation workshop.",
      owner: "Demo team",
      objective: "Get a faculty advisor or student club leader to book a call about hosting a free innovation workshop",
      offer:
        "A free, half-day innovation workshop for student technical clubs, run by working engineers. It covers going from an idea to a working prototype in a weekend and how to run a build event. We bring the material and the mentors and the college provides a room. There is no charge.",
      brief:
        "You are an SDR for a small group of working engineers who run free workshops for student clubs. You write warmly and respectfully, use academic titles for faculty, and never sound like a sales message. You only describe what is in the offer and the knowledge. You never ask for money and never promise outcomes for students. The goal is a short call to plan a date.",
      mode: "bulk", sourcing: "simulated-search", audienceKind: "organisations",
      icpText: "Faculty advisors and student leaders (club presidents, heads of technical societies) at engineering colleges and universities in India that run technical clubs or hackathons.",
      geography: ["India"], personas: ["Faculty Advisor", "Club President", "Head of Technical Society"],
      companyCriteria: "Engineering college or university with active technical clubs or a hackathon",
      exclusionCriteria: "Schools below college level and coaching institutes",
      channels: ["email", "linkedin"],
      qualificationPrompt:
        "Qualify when the person advises or leads a technical club, society or hackathon at an engineering college or university in India. A score of 70 or above qualifies. Reject people from schools below college level, coaching institutes, and anyone with no link to student technical activity.",
      dailyLimit: 60, workingHours: HOURS, cadence: { maxTouches: 2, waitHours: 48 },
      approvals: { firstOutreach: true, meetingTime: false, escalate: true, level: "assisted" },
      sources: [
        { name: "Innovation workshop overview", category: "Product", content: "The innovation workshop is a free, half-day event for student technical clubs, led by working engineers.\n\nIt covers how to go from an idea to a working prototype over a weekend, and how to plan and run a build event.\n\nWe bring the material and the mentors. The college provides a room and helps invite students. There is no charge to the college or to the students." },
        { name: "Workshop agenda and format", category: "Product", content: "A typical workshop has three parts: a short session on choosing an idea that can be built in a weekend, a hands-on session where teams sketch and build a first prototype, and a closing session where teams present and get feedback from the mentors.\n\nThe format works for groups of a few dozen students and can be adapted to a club's own theme." },
      ],
    },
    persona: { tone: "warm, respectful of academic titles, enthusiastic but never salesy", signOff: "" },
  },
  {
    values: {
      name: "Tech Summit Speakers: Founders and Creators",
      description: "Invites well-known founders, creators and authors to speak at a student technology summit.",
      owner: "Demo team",
      objective: "Get a notable founder, creator or author to agree to a conversation about speaking at the student technology summit",
      offer:
        "An invitation to give a 30-minute talk at a student technology summit for engineering students from across India, followed by a student question and answer session. We take care of travel and logistics. This is an unpaid invitation.",
      brief:
        "You are the outreach lead for a student technology summit. You write to notable people with respect and precision: say plainly why you are writing to this person and what you are asking, in a few short sentences, without flattery. You are honest that the invitation is unpaid. You only state what is in the offer and the knowledge. The goal is a short conversation about whether they would speak.",
      mode: "bulk", sourcing: "simulated-search", audienceKind: "individuals",
      icpText: "Well-known founders, creators, authors and engineers with a public profile in technology in India, who speak publicly and have a connection to students or education.",
      geography: ["India"], personas: ["Founder", "Author", "Creator"],
      companyCriteria: "", exclusionCriteria: "Anyone who has said publicly that they do not accept unpaid speaking invitations",
      channels: ["email"],
      qualificationPrompt:
        "Qualify when the person is publicly known in technology in India, speaks publicly, and has a plausible link to students or education. A score of 70 or above qualifies. Reject people with no public profile in technology and anyone who does not speak publicly.",
      dailyLimit: 20, workingHours: HOURS, cadence: { maxTouches: 2, waitHours: 72 },
      approvals: { firstOutreach: true, meetingTime: true, escalate: true, level: "manual" },
      sources: [
        { name: "Summit overview", category: "Product", content: "The student technology summit brings together engineering students from colleges across India for a day of talks, demos and conversations with people working in technology.\n\nSpeakers give a 30-minute talk followed by a student question and answer session. The organisers handle travel and logistics." },
        { name: "Speaker invitation terms", category: "Other", content: "The invitation is unpaid. We are honest about this in every invitation.\n\nWe ask for a 30-minute talk and up to 20 minutes of student questions. We can work around the speaker's calendar and will confirm dates and travel with the speaker's team." },
      ],
    },
    persona: { tone: "respectful, precise and honest; short sentences; no flattery", signOff: "" },
  },
];

let token = null;
async function call(path, options = {}) {
  const res = await fetch(`${base}${path}`, { ...options, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${options.method || "GET"} ${path}: ${(body && body.error) || res.status}`);
  return body;
}
const post = (path, body = {}) => call(path, { method: "POST", body: JSON.stringify(body) });

const health = await fetch(`${base}/health`).then((r) => r.json()).catch(() => null);
if (!health || !health.ok) {
  console.error(`Cannot reach ${base}/health. Is the site awake? Open it in a browser and try again.`);
  process.exit(1);
}
if (health.signInRequired) {
  const login = await post("/api/auth/login", { name: "demo setup", code: process.env.DEMO_ACCESS_CODE || "" });
  token = login.token;
}

const { campaigns } = await call("/api/command-center");
const { reps } = await call("/api/reps");
const activeReps = reps.filter((r) => r.status === "active");
if (activeReps.length < 2) {
  console.error("At least two active representatives are needed. Add them on the Representatives page first.");
  process.exit(1);
}

console.log(`Site: ${base}   (agent engine: ${health.agentEngine})\n`);
console.log(`Will archive ${campaigns.length} existing campaign${campaigns.length === 1 ? "" : "s"}:`);
for (const c of campaigns) console.log(`  - ${c.name}  [${c.status}]`);
console.log("\nWill create and launch:");
for (const d of DEMO) console.log(`  + ${d.values.name}  (${d.values.approvals.level} approval, ${d.values.channels.join(" + ")}, ${d.values.audienceKind})`);

if (!yes) console.log("\nNothing was changed. Run again with --yes to do it.");

if (yes) {
console.log("\nArchiving...");
for (const c of campaigns) {
  try {
    if (c.status === "live") await post(`/api/campaigns/${c.id}/complete`);
    else if (c.status === "paused" || c.status === "stopped") await post(`/api/campaigns/${c.id}/complete`).catch(() => null);
    await post(`/api/campaigns/${c.id}/archive`);
    console.log(`  archived  ${c.name}`);
  } catch (e) {
    console.log(`  skipped   ${c.name} (${e.message})`);
  }
}

console.log("\nCreating...");
let n = 0;
for (const d of DEMO) {
  const created = await post("/api/campaigns", { values: d.values, launch: true });
  const pair = [activeReps[n % activeReps.length].id, activeReps[(n + 1) % activeReps.length].id];
  await post(`/api/campaigns/${created.id}/reps`, { repIds: [...new Set(pair)] });
  await post(`/api/campaigns/${created.id}/persona`, d.persona);
  n += 1;
  console.log(`  live      ${d.values.name}  (${created.id})`);
}
console.log("\nDone. Open the Command Center: three campaigns are running. Approvals will start to fill within a minute.");
}
