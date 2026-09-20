// Seed data — ported from the frontend's src/data/seed.js so the backend starts in exactly
// the state the 8 wireframes/screens were built against. `sources[].docId` is new: it points
// at a real text file under data/knowledge/ so the RAG service has real content to retrieve
// (the frontend mock only ever needed the file *name* for display).
import { initCampaignPrompts } from "../services/prompts.js";

export const SCHEMA_VERSION = 2; // 2: per-campaign knowledge sources, approval levels

export function buildSeed(now) {
  const m = (n) => now - n * 60 * 1000;
  const hrs = (n) => now - n * 60 * 60 * 1000;
  const days = (n) => now - n * 24 * 60 * 60 * 1000;

  // Knowledge sources are per campaign: each points (docId) at a text file in data/knowledge/ that the
  // RAG service embeds and searches, but only for that campaign. Shared docs (the product one-pager)
  // appear in several; the playbooks, case studies and objection guides are specific to one audience.
  const doc = (id, name, category, docId) => ({ id, name, category, docId });
  const productDoc = () => doc("s1", "NimbusGuard — Product One-Pager.pdf", "Product info", "product-one-pager");
  const sourcesFor = {
    saas: () => [
      productDoc(),
      doc("s2", "Case Study — Fleetwise: Infra Cost Savings at Scale.pdf", "Case study", "case-study-fleetwise"),
      doc("s3", "Objection Handling Playbook.pdf", "Objections", "objection-handling"),
      doc("s4", "Sales Playbook — US SaaS CTO Outreach.pdf", "Playbook & examples", "playbook-saas-cto"),
    ],
    bfsi: () => [
      productDoc(),
      doc("s5", "Case Study — Kaveri Finserv: Visibility Without Moving Data.pdf", "Case study", "case-study-bfsi"),
      doc("s6", "Objection Handling — Regulated BFSI (India).pdf", "Objections", "objection-handling-bfsi"),
      doc("s7", "Sales Playbook — India BFSI CIO Outreach.pdf", "Playbook & examples", "playbook-bfsi-cio"),
    ],
    founders: () => [
      productDoc(),
      doc("s8", "Case Study — Voxwell: Inference Cost for Voice AI.pdf", "Case study", "case-study-voice-ai"),
      doc("s9", "Objection Handling — Startup Founders.pdf", "Objections", "objection-handling-founders"),
      doc("s10", "Sales Playbook — AI Startup Founders.pdf", "Playbook & examples", "playbook-ai-founders"),
    ],
  };

  const campaigns = [
    {
      id: "c_us_saas",
      offer:
        "A cloud cost and security layer that finds wasted spend and security gaps across AWS, GCP and Azure in days, using read-only access and no migration.",
      name: "US SaaS CTO Outreach",
      shortName: "US SaaS CTO",
      status: "live",
      owner: "Priya S.",
      objective: "Book a qualified meeting",
      description:
        "Outbound to CTOs and VPs of Engineering at 50–500 employee SaaS companies, positioning NimbusGuard's cloud cost and security layer.",
      icpSummary: "SaaS CTOs & VP Eng · 50–500 employees · US",
      icpText: "CTO or VP Engineering at a US SaaS company with 50–500 employees and a recent cloud-cost signal.",
      geography: ["United States"],
      personas: ["CTO", "VP Engineering"],
      companyCriteria: "50–500 employees · SaaS · Hiring platform or infra roles",
      exclusionCriteria: "Already a customer · Competitor · Contacted by another campaign in last 14 days",
      channels: ["email", "linkedin"],
      qualificationPrompt:
        "Qualify if the company is hiring cloud-cost or platform roles OR has raised in the last 12 months, and the contact is a CTO or VP Engineering. Qualify at 70 or above.",
      dailyLimit: 60,
      workingHours: "9:00 AM – 6:00 PM, prospect local time",
      cadence: { maxTouches: 3, waitHours: 72 },
      sourcing: "synthetic",
      mode: "bulk",
      approvals: { firstOutreach: true, meetingTime: false, escalate: true, level: "assisted", autoMinScore: 85, autoAfterApproved: 3 },
      sources: sourcesFor.saas(),
      funnel: { discovered: 1840, researched: 1620, qualified: 780, contacted: 426, engaged: 210, meeting: 18, opportunity: 7 },
      outreach: { emails: 340, linkedin: 86, replies: 54, followups: 112, costPerQualified: 0.62 },
      responseRate: 18.2,
      createdTs: days(30),
      modifiedTs: hrs(2),
    },
    {
      id: "c_india_bfsi",
      offer:
        "A cloud cost and security layer that gives regulated lenders and insurers cost and posture visibility with in-country data residency, read-only access and dedicated tenancy.",
      name: "India BFSI CIO Outreach",
      shortName: "India BFSI CIO",
      status: "paused",
      owner: "Rohit K.",
      objective: "Book a qualified meeting",
      description:
        "Outbound to CIOs and heads of risk at banks, NBFCs and insurers in India, positioning compliance-ready infrastructure security.",
      icpSummary: "CIO / Head of Risk · Banks, NBFCs, Insurers · India",
      icpText: "CIO or Head of Risk at an Indian bank, NBFC or insurer with a regulated data-residency requirement.",
      geography: ["India"],
      personas: ["CIO", "Head of Risk"],
      companyCriteria: "Regulated BFSI entity · 500+ employees",
      exclusionCriteria: "Already a customer · Competitor · Contacted by another campaign in last 14 days",
      channels: ["email", "voice"],
      qualificationPrompt: "Qualify if the entity is RBI-regulated and the contact owns technology or risk decisions. Qualify at 70 or above.",
      dailyLimit: 30,
      workingHours: "10:00 AM – 6:00 PM IST",
      cadence: { maxTouches: 3, waitHours: 72 },
      sourcing: "synthetic",
      mode: "bulk",
      approvals: { firstOutreach: true, meetingTime: true, escalate: true, level: "manual", autoMinScore: 85, autoAfterApproved: 3 },
      sources: sourcesFor.bfsi(),
      funnel: { discovered: 980, researched: 860, qualified: 330, contacted: 211, engaged: 96, meeting: 11, opportunity: 4 },
      outreach: { emails: 190, linkedin: 0, replies: 29, followups: 64, costPerQualified: 0.81 },
      responseRate: 13.7,
      createdTs: days(24),
      modifiedTs: days(1),
    },
    {
      id: "c_ai_founders",
      offer:
        "A cloud and inference cost layer that shows AI startups where GPU and cloud spend leaks, read-only and without a migration.",
      name: "AI Startup Founders",
      shortName: "AI Startup Founders",
      status: "live",
      owner: "Priya S.",
      objective: "Book a qualified meeting",
      description:
        "Outbound to founders and CEOs at early-stage voice / conversational AI startups, positioning NimbusGuard's infra cost & security layer.",
      icpSummary: "Founders/CEOs · Voice & Conversational AI · Seed–Series A · US",
      icpText: "Founder or CEO at a seed–Series A voice / conversational AI startup, 5–60 employees, actively scaling infrastructure.",
      geography: ["United States"],
      personas: ["Founder", "CEO"],
      companyCriteria: "5–60 employees · Seed to Series A · Raised in last 18 months",
      exclusionCriteria: "Already a customer · Competitor · Contacted by another campaign in last 14 days",
      channels: ["email", "sms"],
      qualificationPrompt:
        "Qualify if company is actively hiring infra/platform roles OR has raised a round in the last 6 months, and the contact's title matches Founder/CEO. Qualify at 70 or above.",
      dailyLimit: 40,
      workingHours: "9:00 AM – 6:00 PM, prospect local time",
      cadence: { maxTouches: 3, waitHours: 72 },
      sourcing: "synthetic",
      mode: "bulk",
      approvals: { firstOutreach: true, meetingTime: false, escalate: true, level: "autonomous", autoMinScore: 85, autoAfterApproved: 3 },
      sources: sourcesFor.founders(),
      funnel: { discovered: 640, researched: 560, qualified: 220, contacted: 142, engaged: 79, meeting: 9, opportunity: 3 },
      outreach: { emails: 120, linkedin: 0, replies: 21, followups: 41, costPerQualified: 0.74 },
      responseRate: 14.8,
      createdTs: days(18),
      modifiedTs: days(2),
    },
  ];

  const mk = (o) => ({ linkedin: "", history: [], conversation: [], evidence: [], reasons: [], tech: [], touches: [], plan: null, nextTouchTs: null, ...o });

  const prospects = [
    mk({ id: "p_marcus", campaignId: "c_us_saas", name: "Marcus Lee", title: "CTO", company: "Acme Cloud",
      email: "marcus.lee@acmecloud.io", city: "San Francisco, CA", linkedin: "linkedin.com/in/marcuslee",
      industry: "DevOps SaaS", size: "180 employees", funding: "Series B, $42M raised",
      tech: ["AWS", "Kubernetes", "Datadog", "Terraform"], stage: "contacted", fit: 92, channel: "Email",
      lastAction: "Follow-up drafted, {ago}", lastTs: m(3), nextStep: "Awaiting approval",
      reasons: ["Matches target company size (50–500 employees)", "Role matches ICP persona (CTO)", 'Recent hiring signal: "Platform Engineer, AWS cost optimisation"'],
      qual: { status: "Qualified", reasoning: "Meets ICP on company size, role and buying signal; no exclusion criteria triggered.", agent: "ICP Fitment Agent", harness: "harness v3.2", ts: hrs(2) },
      evidence: ["Hiring: Platform Engineer (AWS cost)", "Uses Kubernetes (job postings)", "Attended KubeCon 2026", "Series B closed — Mar 2026"],
      history: [
        { kind: "email", text: 'Opening email sent — "Cutting AWS spend without slowing releases"', when: "Sep 15" },
        { kind: "chat", text: "LinkedIn connection request sent (simulated channel)", when: "Sep 16" },
        { kind: "email", text: "Reply received — asked about pricing", when: "Today, 1:52 PM" },
      ],
      conversation: [
        { dir: "out", text: "Hi Marcus — noticed Acme Cloud's been hiring for platform/AWS cost roles. Teams like Fleetwise cut cloud spend 23% in 60 days without slowing releases using NimbusGuard. Worth a quick look?", when: "Sep 15, 10:04 AM" },
        { dir: "in", text: "Interesting — tell me more about pricing and how it works with our existing Datadog setup.", when: "Today, 1:52 PM" },
      ] }),
    mk({ id: "p_dana", campaignId: "c_us_saas", name: "Dana Priest", title: "VP Eng", company: "Fleetwise",
      email: "dana.priest@fleetwise.io", city: "Austin, TX", linkedin: "linkedin.com/in/danapriest",
      industry: "Logistics SaaS", size: "240 employees", funding: "Series C, $65M raised", tech: ["AWS", "Terraform", "Grafana"],
      stage: "qualified", fit: 88, channel: "—", lastAction: "Qualified, {ago}", lastTs: m(17), nextStep: "Personalise & send",
      reasons: ["Company size within the 50–500 range", "VP Eng is a target persona", "Existing NimbusGuard case-study logo"],
      qual: { status: "Qualified", reasoning: "Strong fit on size and persona; score 88/100.", agent: "ICP Fitment Agent", harness: "harness v3.2", ts: m(17) },
      evidence: ["Hiring: Cloud FinOps Engineer", "Runs multi-region AWS", "Case study referenced in the knowledge base"],
      history: [{ kind: "chat", text: "Research record completed by Lead Research Agent", when: "Today" }] }),
    mk({ id: "p_wei", campaignId: "c_us_saas", name: "Wei Chen", title: "CTO", company: "CloudNet",
      email: "wei.chen@cloudnet.dev", city: "Seattle, WA", linkedin: "linkedin.com/in/weichen",
      industry: "Cloud networking", size: "320 employees", funding: "Series B, $38M raised", tech: ["GCP", "Kubernetes", "Prometheus"],
      stage: "engaged", fit: 81, channel: "Email", lastAction: "Objection raised, {ago}", lastTs: m(54), nextStep: "Human review",
      reasons: ["Within target company size", "CTO persona match", "Active infrastructure hiring"],
      qual: { status: "Qualified", reasoning: "Meets ICP; engaged after first email, then raised a compliance objection.", agent: "ICP Fitment Agent", harness: "harness v3.2", ts: hrs(30) },
      evidence: ["Replied to opening email", "Asked about SOC 2 and data residency", "Series B closed — Jan 2026"],
      history: [
        { kind: "email", text: 'Opening email sent — "Cutting cloud spend without slowing releases"', when: "Sep 16" },
        { kind: "email", text: "Reply received — security / compliance objection", when: "Today" },
      ],
      conversation: [
        { dir: "out", text: "Hi Wei — teams like CloudNet often cut spend 20%+ with NimbusGuard. Worth a look?", when: "Sep 16, 9:40 AM" },
        { dir: "in", text: "Before we go further — can you share your SOC 2 report and where data is stored?", when: "Today, 11:05 AM" },
      ] }),
    mk({ id: "p_yuki", campaignId: "c_us_saas", name: "Yuki Tanaka", title: "CTO", company: "Northwind Data",
      email: "yuki.tanaka@northwinddata.com", city: "Denver, CO", linkedin: "linkedin.com/in/yukitanaka",
      industry: "Data infrastructure", size: "150 employees", funding: "Series B, $30M raised", tech: ["AWS", "Snowflake", "Datadog"],
      stage: "meeting", fit: 95, channel: "Email + LinkedIn", lastAction: "Meeting booked, Sep 24", lastTs: hrs(5), nextStep: "Prep for call",
      reasons: ["Ideal size and persona", "Recent cloud-cost hiring signal", "Replied within 2 hours"],
      qual: { status: "Qualified", reasoning: "Top-scoring prospect; meeting booked for Sep 24.", agent: "ICP Fitment Agent", harness: "harness v3.2", ts: days(3) },
      evidence: ["Hiring: Platform Engineer", "Replied to opening email", "Accepted LinkedIn request"],
      history: [
        { kind: "email", text: "Opening email sent", when: "Sep 14" },
        { kind: "chat", text: "LinkedIn connection accepted (simulated channel)", when: "Sep 15" },
        { kind: "email", text: "Meeting booked for Sep 24", when: "Sep 17" },
      ] }),
    mk({ id: "p_leah", campaignId: "c_us_saas", name: "Leah Ortiz", title: "VP Eng", company: "Byteform",
      email: "leah.ortiz@byteform.co", city: "Boston, MA", linkedin: "linkedin.com/in/leahortiz",
      industry: "Developer tools", size: "12 employees", funding: "Seed, $4M raised", tech: ["AWS", "Vercel"],
      stage: "researched", fit: null, channel: "—", lastAction: "Enriched, {ago}", lastTs: m(31), nextStep: "ICP scoring",
      reasons: ["Awaiting ICP scoring"],
      qual: { status: "Pending", reasoning: "Research complete; waiting for the ICP Fitment Agent.", agent: "Lead Research Agent", harness: "harness v2.0", ts: m(31) },
      evidence: ["Enriched from company website", "Team size sourced from public profile"],
      history: [{ kind: "chat", text: "Research record completed by Lead Research Agent", when: "Today" }] }),
    mk({ id: "p_alex", campaignId: "c_us_saas", name: "Alex Kim", title: "Founder", company: "Sana Corp",
      email: "alex@sanacorp.io", city: "Chicago, IL", linkedin: "linkedin.com/in/alexkim",
      industry: "Analytics SaaS", size: "9 employees", funding: "Pre-seed", tech: ["GCP"],
      stage: "rejected", fit: 34, channel: "—", lastAction: "Rejected — below ICP size, {ago}", lastTs: hrs(1), nextStep: "—",
      reasons: ["Company size is below the 50-employee threshold", "Persona is not in the target list"],
      qual: { status: "Rejected", reasoning: "Under 50 employees and outside the target persona.", agent: "ICP Fitment Agent", harness: "harness v3.2", ts: hrs(1) },
      evidence: ["9 employees (public profile)", "No cloud-cost hiring signal"] }),
    mk({ id: "p_ananya", campaignId: "c_india_bfsi", name: "Ananya Rao", title: "CIO", company: "Vertex Bank",
      email: "ananya.rao@vertexbank.in", city: "Mumbai, IN", linkedin: "linkedin.com/in/ananyarao",
      industry: "Retail banking", size: "4,200 employees", funding: "Listed", tech: ["Azure", "Oracle", "ServiceNow"],
      stage: "meeting", fit: 90, channel: "Email", lastAction: "Meeting booked, Sep 24", lastTs: m(41), nextStep: "Prep for call",
      reasons: ["RBI-regulated entity", "CIO owns technology decisions", "Data-residency requirement matches the ICP"],
      qual: { status: "Qualified", reasoning: "Regulated bank with a clear data-residency need.", agent: "ICP Fitment Agent", harness: "harness v3.2", ts: days(4) },
      evidence: ["RBI-regulated bank", "Published cloud migration roadmap", "Replied to opening email"],
      history: [
        { kind: "email", text: "Opening email sent", when: "Sep 13" },
        { kind: "email", text: "Reply received — asked about pricing", when: "Sep 17" },
        { kind: "email", text: "Meeting booked for Sep 24, 3:00 PM", when: "Today" },
      ],
      conversation: [
        { dir: "out", text: "Namaste Ananya — many Indian banks are meeting data-residency norms with NimbusGuard. Worth a short conversation?", when: "Sep 13, 10:10 AM" },
        { dir: "in", text: "Yes, please share indicative pricing and how it handles data residency.", when: "Sep 17, 2:30 PM" },
      ] }),
    mk({ id: "p_rajiv", campaignId: "c_india_bfsi", name: "Rajiv Menon", title: "Head of Risk", company: "Meridian Insurance",
      email: "rajiv.menon@meridianins.in", city: "Pune, IN", linkedin: "linkedin.com/in/rajivmenon",
      industry: "Insurance", size: "1,800 employees", funding: "Listed", tech: ["AWS", "Salesforce"],
      stage: "contacted", fit: 84, channel: "Email", lastAction: "Opening email sent, {ago}", lastTs: hrs(4), nextStep: "Awaiting reply",
      reasons: ["Regulated insurer", "Head of Risk is a target persona"],
      qual: { status: "Qualified", reasoning: "Regulated insurer with a risk-owner contact.", agent: "ICP Fitment Agent", harness: "harness v3.2", ts: hrs(30) },
      evidence: ["IRDAI-regulated", "Recent audit finding on vendor risk"],
      history: [{ kind: "email", text: "Opening email sent", when: "Today" }] }),
    mk({ id: "p_kavya", campaignId: "c_india_bfsi", name: "Kavya Nair", title: "CIO", company: "Bharat Capital",
      email: "kavya.nair@bharatcapital.in", city: "Bengaluru, IN", linkedin: "linkedin.com/in/kavyanair",
      industry: "NBFC", size: "900 employees", funding: "Listed", tech: ["Azure", "Kubernetes"],
      stage: "qualified", fit: 79, channel: "—", lastAction: "Qualified, {ago}", lastTs: hrs(5), nextStep: "Personalise & send",
      reasons: ["NBFC within the target segment", "CIO persona match"],
      qual: { status: "Qualified", reasoning: "NBFC with a CIO-led technology agenda.", agent: "ICP Fitment Agent", harness: "harness v3.2", ts: hrs(5) },
      evidence: ["RBI-registered NBFC", "Hiring: Security Engineer"],
      history: [{ kind: "chat", text: "Research record completed by Lead Research Agent", when: "Today" }] }),
    mk({ id: "p_sam", campaignId: "c_ai_founders", name: "Sam Patel", title: "Founder", company: "VoiceForge",
      email: "sam@voiceforge.ai", city: "Austin, TX", linkedin: "linkedin.com/in/sampatel",
      industry: "Voice AI", size: "22 employees", funding: "Seed, $6M raised", tech: ["GCP", "Kubernetes", "WebRTC"],
      stage: "engaged", fit: 89, channel: "Email", lastAction: "Replied — wants to meet, {ago}", lastTs: hrs(1), nextStep: "Book meeting",
      reasons: ["Seed-stage voice AI company", "Founder persona match", "Raised within the last 6 months"],
      qual: { status: "Qualified", reasoning: "Voice AI seed company scaling infrastructure.", agent: "ICP Fitment Agent", harness: "harness v3.2", ts: days(2) },
      evidence: ["Raised seed in Apr 2026", "Hiring: Infrastructure Engineer", "Replied to opening email"],
      history: [
        { kind: "email", text: "Opening email sent", when: "Sep 16" },
        { kind: "email", text: "Reply received — asked for a call on Thursday", when: "Today" },
      ],
      conversation: [
        { dir: "out", text: "Hi Sam — voice AI teams scaling past 10k concurrent calls use NimbusGuard to keep infra cost predictable. Open to a quick chat?", when: "Sep 16, 11:00 AM" },
        { dir: "in", text: "Sounds relevant. Could we do Thursday afternoon?", when: "Today, 12:20 PM" },
      ] }),
    mk({ id: "p_tara", campaignId: "c_ai_founders", name: "Tara Novak", title: "CEO", company: "Echoloop",
      email: "tara@echoloop.ai", city: "New York, NY", linkedin: "linkedin.com/in/taranovak",
      industry: "Conversational AI", size: "35 employees", funding: "Series A, $14M raised", tech: ["AWS", "Redis"],
      stage: "contacted", fit: 83, channel: "SMS", lastAction: "SMS sent, {ago}", lastTs: hrs(3), nextStep: "Awaiting reply",
      reasons: ["Series A conversational AI company", "CEO persona match"],
      qual: { status: "Qualified", reasoning: "Series A company within the target profile.", agent: "ICP Fitment Agent", harness: "harness v3.2", ts: days(1) },
      evidence: ["Series A closed — May 2026", "Hiring: Platform Engineer"],
      history: [{ kind: "chat", text: "SMS sent", when: "Today" }] }),
    mk({ id: "p_jonas", campaignId: "c_ai_founders", name: "Jonas Berg", title: "Founder", company: "Lumenvoice",
      email: "jonas@lumenvoice.ai", city: "Seattle, WA", linkedin: "linkedin.com/in/jonasberg",
      industry: "Voice AI", size: "14 employees", funding: "Seed, $3M raised", tech: ["GCP", "Kafka"],
      stage: "qualified", fit: 86, channel: "—", lastAction: "Qualified, {ago}", lastTs: hrs(4), nextStep: "Personalise & send",
      reasons: ["Seed-stage voice AI company", "Founder persona match"],
      qual: { status: "Qualified", reasoning: "Early-stage voice AI founder.", agent: "ICP Fitment Agent", harness: "harness v3.2", ts: hrs(4) },
      evidence: ["Raised seed in Mar 2026", "Public roadmap mentions scaling call volume"],
      history: [{ kind: "chat", text: "Research record completed by Lead Research Agent", when: "Today" }] }),
  ];

  const events = [
    { id: "e1", campaignId: "c_us_saas", type: "draft", text: "Personalisation Agent drafted a follow-up email for **Marcus Lee** (Acme Cloud)", ts: m(3), featured: true },
    { id: "e2", campaignId: "c_india_bfsi", type: "reject", text: "ICP Fitment Agent rejected **Sana Corp** — under 50 employees, below size threshold", ts: m(12), featured: true },
    { id: "e3", campaignId: "c_us_saas", type: "qualify", text: "ICP Fitment Agent qualified **Dana Priest**, Fleetwise (score 88/100)", ts: m(17), featured: false },
    { id: "e4", campaignId: "c_ai_founders", type: "conflict", text: "Conflict Resolution blocked outreach to **Wei Chen** — already contacted by another campaign 8h ago", ts: m(24), featured: true },
    { id: "e5", campaignId: "c_us_saas", type: "enrich", text: "Lead Research Agent enriched 14 new prospects from this week's discovery batch", ts: m(31), featured: false },
    { id: "e6", campaignId: "c_india_bfsi", type: "meeting", text: "Conversation Agent booked a meeting with **Ananya Rao** (Vertex Bank) for Sep 24, 3:00 PM", ts: m(41), featured: true },
    { id: "e7", campaignId: "c_us_saas", type: "escalate", text: "Conversation Agent escalated **Wei Chen** — pricing objection needs human input", ts: m(54), featured: false },
  ];

  const D = (o) => ({ prospectId: null, score: null, retrieved: [], evidence: [], instruction: "", conflict: { ok: true, text: "No conflicts found" }, ...o });

  const decisions = [
    D({ id: "d1", kind: "qualified", campaignId: "c_us_saas", prospectId: "p_marcus", agent: "ICP Fitment Agent", harness: "harness v3.2", ts: hrs(2),
      headline: "Qualified — Marcus Lee, Acme Cloud", summary: "ICP Fitment Agent qualified **Marcus Lee**, Acme Cloud",
      evidence: ["Role: CTO — matches target persona", "Company size: 180 employees — within 50–500 range", 'Signal: hiring "Platform Engineer, AWS cost optimisation"'],
      score: 92, retrieved: ["ICP Definition — SaaS CTO, v2", "Case Study — Fleetwise, 23% infra cost reduction"],
      instruction: "Prioritise companies with a recent cloud-cost-related hiring signal; require 50–500 employees.",
      finalAction: "Move to Qualified → hand off to Personalisation Agent" }),
    D({ id: "d2", kind: "blocked", campaignId: "c_ai_founders", prospectId: "p_alex", agent: "Conflict Resolution Agent", harness: "harness v1.4", ts: hrs(1),
      headline: "Outreach blocked — Sana Corp", summary: "Outreach blocked — **Sana Corp** already contacted by India BFSI CIO Outreach 8h ago",
      evidence: ["Contact: Alex Kim, Founder — Sana Corp", "Prior outreach: India BFSI CIO Outreach, email, 8h ago", "Rule: one campaign per prospect within 14 days"],
      score: 34, retrieved: ["Contact Policy — Cross-campaign suppression, v1"],
      instruction: "Never contact a prospect already engaged by another campaign within the last 14 days.",
      conflict: { ok: false, text: "Conflict found — outreach blocked" }, finalAction: "Skip prospect and notify the campaign owner" }),
    D({ id: "d3", kind: "meeting", campaignId: "c_india_bfsi", prospectId: "p_ananya", agent: "Conversation & Follow-up Agent", harness: "harness v2.1", ts: hrs(3),
      headline: "Meeting booked — Ananya Rao, Vertex Bank", summary: "Conversation Agent booked a meeting with **Ananya Rao**, Vertex Bank for Sep 24, 3:00 PM",
      evidence: ["Prospect replied asking for indicative pricing", "Prospect proposed a call the following week", "Calendar slot confirmed: Sep 24, 3:00 PM"],
      score: 90, retrieved: ["Objection Handling Playbook — BFSI, v3", "Pricing FAQ — Regulated industries"],
      instruction: "Propose a 20-minute call once the prospect asks about pricing or data residency.",
      finalAction: "Create calendar event and notify the campaign owner" }),
    D({ id: "d4", kind: "rejected", campaignId: "c_us_saas", prospectId: "p_leah", agent: "ICP Fitment Agent", harness: "harness v3.2", ts: hrs(5),
      headline: "Rejected — Byteform Inc.", summary: "ICP Fitment Agent rejected **Byteform Inc.** — company size below threshold (12 employees)",
      evidence: ["Company size: 12 employees — below the 50–500 range", "No cloud-cost hiring signal found"],
      score: 41, retrieved: ["ICP Definition — SaaS CTO, v2"],
      instruction: "Prioritise companies with a recent cloud-cost-related hiring signal; require 50–500 employees.",
      finalAction: "Mark as not qualified and stop outreach" }),
    D({ id: "d5", kind: "enriched", campaignId: "c_us_saas", agent: "Lead Research & Enrichment Agent", harness: "harness v2.0", ts: hrs(9),
      headline: "Enriched — 14 new prospects", summary: "Lead Research Agent enriched **14 new prospects** from this week's discovery batch",
      evidence: ["Source: approved company database", "Fields added: size, funding, tech stack, hiring signals"],
      retrieved: ["Data Source Policy — approved providers, v2"],
      instruction: "Enrich only from approved sources and never fabricate missing fields.",
      finalAction: "Queue enriched prospects for ICP scoring" }),
    D({ id: "d6", kind: "qualified", campaignId: "c_us_saas", prospectId: "p_dana", agent: "ICP Fitment Agent", harness: "harness v3.2", ts: hrs(12),
      headline: "Qualified — Dana Priest, Fleetwise", summary: "ICP Fitment Agent qualified **Dana Priest**, Fleetwise (score 88/100)",
      evidence: ["Role: VP Eng — matches target persona", "Company size: 240 employees", "Signal: hiring Cloud FinOps Engineer"],
      score: 88, retrieved: ["ICP Definition — SaaS CTO, v2"],
      instruction: "Prioritise companies with a recent cloud-cost-related hiring signal; require 50–500 employees.",
      finalAction: "Move to Qualified → hand off to Personalisation Agent" }),
    D({ id: "d7", kind: "strategy", campaignId: "c_us_saas", prospectId: "p_yuki", agent: "Personalisation & Outreach Strategy Agent", harness: "harness v4.1", ts: days(1),
      headline: "Channel chosen — Yuki Tanaka, Northwind Data", summary: "Personalisation Agent chose email then LinkedIn for **Yuki Tanaka**, Northwind Data",
      evidence: ["Prospect is active on LinkedIn", "Recent hiring post referencing cloud cost"],
      score: 95, retrieved: ["Channel Playbook — SaaS CTOs, v2"],
      instruction: "Lead with email; follow with LinkedIn only after a reply or open signal.",
      finalAction: "Send opening email, schedule LinkedIn follow-up" }),
  ];

  const A = (o) => ({ status: "pending", decidedBy: null, decidedTs: null, reason: "", ...o });

  const approvals = [
    A({ id: "a_marcus", type: "followup", prospectId: "p_marcus", campaignId: "c_us_saas", name: "Marcus Lee", company: "Acme Cloud",
      tag: "Send follow-up email", tagTone: "neutral", summary: "Send follow-up email — **Marcus Lee**, Acme Cloud", requestedTs: m(12),
      recommendation: { title: "Send the pricing follow-up now — response likelihood is high.",
        body: "Marcus replied within 90 minutes asking about pricing and Datadog compatibility — a strong buying signal for this ICP. The draft below directly answers both questions and proposes a short call while intent is high." },
      draft: { subject: "NimbusGuard pricing + your Datadog stack",
        body: "Hi Marcus, great question. NimbusGuard starts at $0.02/GB monitored, and pulls straight into your existing Datadog dashboards — no rip and replace. I've attached the one-pager. Would a 15-minute call this week work to walk through it live?" },
      nextActionText: "Send pricing one-pager, address Datadog integration directly, and propose a 15-minute call.",
      source: "Recommended by Conversation Agent · harness v2.1" }),
    A({ id: "a_ananya", type: "pricing", prospectId: "p_ananya", campaignId: "c_india_bfsi", name: "Ananya Rao", company: "Vertex Bank",
      tag: "Approve pricing disclosure", tagTone: "neutral", summary: "Approve pricing disclosure — **Ananya Rao**, Vertex Bank", requestedTs: m(40),
      recommendation: { title: "Share indicative pricing — it is needed to keep the meeting on track.",
        body: "Ananya asked for indicative pricing before the Sep 24 call. Pricing disclosure requires human approval under this campaign's settings. The draft shares a range and offers to confirm exact figures on the call." },
      draft: { subject: "Indicative pricing for Vertex Bank",
        body: "Namaste Ananya, thank you for the question. For a regulated deployment with in-country data residency, pricing typically starts at $0.03/GB monitored, with volume tiers above that. We'll confirm exact figures on Sep 24. Please let me know if there is anything you'd like us to prepare." },
      nextActionText: "Share indicative pricing range and confirm exact figures on the Sep 24 call.",
      source: "Recommended by Personalisation Agent · harness v4.1" }),
    A({ id: "a_sam", type: "meeting", prospectId: "p_sam", campaignId: "c_ai_founders", name: "Sam Patel", company: "VoiceForge",
      tag: "Book meeting", tagTone: "neutral", summary: "Book meeting — **Sam Patel**, VoiceForge", requestedTs: hrs(1),
      recommendation: { title: "Confirm Thursday afternoon — the founder proposed the slot.",
        body: "Sam replied asking for Thursday afternoon. Both calendars are free at 3:30 PM. Confirming quickly keeps momentum with an engaged founder." },
      draft: { subject: "Thursday at 3:30 PM works",
        body: "Hi Sam, Thursday at 3:30 PM works well on our side. I'll send a calendar invite with a video link. Happy to keep it to 20 minutes and focus on how teams at your stage keep voice infrastructure costs predictable." },
      nextActionText: "Confirm Thursday at 3:30 PM and send a calendar invite.",
      source: "Recommended by Conversation Agent · harness v2.1" }),
    A({ id: "a_wei", type: "escalation", prospectId: "p_wei", campaignId: "c_us_saas", name: "Wei Chen", company: "CloudNet",
      tag: "Escalation: security objection", tagTone: "danger", summary: "Escalation — **Wei Chen** raised a security/compliance objection", requestedTs: hrs(2),
      recommendation: { title: "Respond personally — the objection needs a compliance answer.",
        body: "Wei asked for a SOC 2 report and where data is stored. The agent cannot commit to compliance claims, so this needs a human reply. A short, accurate answer and an offer of the security pack should keep the conversation open." },
      draft: { subject: "Re: SOC 2 and data residency",
        body: "Hi Wei, fair question. NimbusGuard is SOC 2 Type II certified and data stays in the region you choose. I'll send our security pack today, and I'm happy to set up a call with our security lead if that's useful." },
      nextActionText: "Reply personally with the security pack and offer a call with the security lead.",
      source: "Escalated by Conversation Agent · harness v2.1" }),
    A({ id: "a_dana", type: "first", prospectId: "p_dana", campaignId: "c_us_saas", name: "Dana Priest", company: "Fleetwise",
      tag: "Send first outreach email", tagTone: "neutral", summary: "Send first outreach email — **Dana Priest**, Fleetwise", requestedTs: hrs(3),
      recommendation: { title: "Send the opening email — strong fit and a live hiring signal.",
        body: "Dana scored 88/100 and Fleetwise is hiring a Cloud FinOps Engineer. This campaign requires approval before first outreach. The draft references the hiring signal and the Fleetwise case study." },
      draft: { subject: "Cutting cloud spend at Fleetwise",
        body: "Hi Dana, I saw Fleetwise is hiring a Cloud FinOps Engineer — usually a sign cloud spend is getting attention. Teams like yours have cut spend 23% in 60 days with NimbusGuard without slowing releases. Worth a quick look?" },
      nextActionText: "Send the opening email referencing the FinOps hiring signal.",
      source: "Recommended by Personalisation Agent · harness v4.1" }),
  ];

  const V = (version, changedBy, date, status, text, activatedBy, activatedTs) => ({
    version, changedBy, date, status, text, activatedBy: activatedBy || null, activatedTs: activatedTs || null,
  });

  const agents = [
    { id: "lead", listName: "Lead Research & Enrichment", title: "Lead Research & Enrichment Agent", settingsName: "Lead Research & Enrichment Agent",
      description: "Discovers and enriches prospects from approved data sources and builds a research record for every lead.",
      enabled: true, disabledBy: null, disabledTs: null,
      versions: [
        V("v2.0", "JD", "Sep 12", "active", "You are the Lead Research & Enrichment agent. Given a discovered prospect, enrich the record with company size, funding, tech stack and hiring signals from approved sources only. Never fabricate fields that are not present in the source data.", "JD", days(7)),
        V("v1.9", "Priya S.", "Sep 4", "archived", "You are the Lead Research agent. Enrich each prospect with company size and funding from approved sources. Leave unknown fields empty.", null, null),
      ], overrides: [] },
    { id: "research", listName: "Research", title: "Research Agent", settingsName: "Research Agent",
      description: "Turns what is known about a prospect into a structured brief: facts, reasons they might care, and what is still unknown. Uses only the supplied facts and never invents.",
      enabled: true, disabledBy: null, disabledTs: null,
      versions: [
        V("v1.0", "JD", "Sep 20", "active", "You are the Research agent. Given one prospect and what is already known about them, restate the important facts, name up to three reasons they might care about this campaign's offer, and list what is still unknown. Use only facts present in the input; never invent an achievement, number, event or connection.", "JD", days(0)),
      ], overrides: [] },
    { id: "icp", listName: "ICP Fitment", title: "ICP Fitment Agent", settingsName: "ICP Fitment Agent",
      description: "Scores each researched prospect against the campaign ICP and decides whether to qualify or reject.",
      enabled: true, disabledBy: null, disabledTs: null,
      versions: [
        V("v3.2", "Priya S.", "Sep 10", "active", "You are the ICP Fitment agent. Score each prospect from 0 to 100 against the campaign ICP using role, company size and buying signals. Qualify at 70 or above, cite the evidence for every score, and reject any prospect that triggers an exclusion criterion.", "Priya S.", days(9)),
        V("v3.1", "Rohit K.", "Aug 30", "archived", "You are the ICP Fitment agent. Score each prospect from 0 to 100 against the campaign ICP. Qualify at 75 or above and list your reasons.", null, null),
      ], overrides: [] },
    { id: "strategy", listName: "Outreach Strategy", title: "Outreach Strategy Agent", settingsName: "Outreach Strategy Agent",
      description: "Plans the touch sequence for each qualified prospect: which channels, in what order, and how long to wait between touches.",
      enabled: true, disabledBy: null, disabledTs: null,
      versions: [
        V("v1.0", "JD", "Sep 20", "active", "You are the Outreach Strategy agent. For a qualified prospect, choose which of the campaign's enabled channels to use, in what order, and how long to wait between touches. Never plan a channel that is not enabled for the campaign. Prefer the channel the prospect's role is most likely to answer on; use SMS only as a later touch and voice last. Keep the sequence within the campaign's touch limit.", "JD", days(0)),
      ], overrides: [] },
    { id: "personalisation", listName: "Personalisation & Outreach Strategy", title: "Personalisation & Outreach Strategy Agent", settingsName: "Personalisation & Outreach Strategy Agent",
      description: "Decides channel and timing, then drafts contextual outreach using retrieved knowledge.",
      enabled: true, disabledBy: null, disabledTs: null,
      versions: [
        V("v4.1", "Priya S.", "Sep 17", "active", "You are the Personalisation agent for this campaign's SDR. Given a qualified prospect and retrieved knowledge, decide the best channel and timing, then draft a short, specific first message referencing one real fact about the prospect. Never fabricate details not present in the research record. Match tone to the campaign's configured voice.", "Priya S.", days(2)),
        V("v4.0", "Rohit K.", "Sep 14", "archived", "You are the Personalisation & Outreach Strategy agent. Given a qualified prospect, choose the best channel and draft a short first message that references one fact from the research record. Keep the tone consistent with the campaign.", null, null),
        V("v3.2", "Priya S.", "Sep 10", "archived", "You are the outreach agent. Draft a first message for each qualified prospect using the research record and the campaign tone. Keep it under 90 words.", null, null),
        V("v3.1", "JD", "Sep 6", "archived", "You are the outreach agent. Draft a short first message for each qualified prospect and pick email unless the campaign says otherwise.", null, null),
      ],
      overrides: [
        { campaignId: "c_india_bfsi", text: "Use formal tone; reference RBI-style data-residency compliance in the first line.", ts: days(3) },
        { campaignId: "c_ai_founders", text: "Casual, peer-to-founder tone; keep first message under 60 words.", ts: days(7) },
      ] },
    { id: "conversation", listName: "Conversation & Follow-up", title: "Conversation & Follow-up Agent", settingsName: "Conversation & Follow-up Agent",
      description: "Handles replies and follow-ups, detects objections, and escalates to a human when needed.",
      enabled: true, disabledBy: null, disabledTs: null,
      versions: [
        V("v2.1", "Rohit K.", "Sep 13", "active", "You are the Conversation & Follow-up agent. Reply to prospects using retrieved knowledge, propose a meeting once intent is clear, and escalate to a human on any pricing, security or compliance objection. Never make commitments that are not in the knowledge base.", "Rohit K.", days(6)),
        V("v2.0", "Priya S.", "Sep 2", "archived", "You are the Conversation agent. Reply to prospects using retrieved knowledge and escalate objections to a human.", null, null),
      ],
      overrides: [{ campaignId: "c_india_bfsi", text: "Escalate any regulatory or data-residency question to a human.", ts: days(5) }] },
    { id: "followup", listName: "Follow-up", title: "Follow-up Agent", settingsName: "Follow-up Agent",
      description: "Follows up with contacted prospects who have not replied, on the next channel in their plan, and stops at the campaign's touch limit.",
      enabled: true, disabledBy: null, disabledTs: null,
      versions: [
        V("v1.0", "JD", "Sep 20", "active", "You are the Follow-up agent. When a contacted prospect has not replied, write a short follow-up for the next channel in their plan. Add one new, relevant fact from the knowledge base; never repeat the previous message, apologise for writing, or pressure the prospect. Never invent details.", "JD", days(0)),
      ], overrides: [] },
    { id: "voice", listName: "Voice SDR (narrow)", title: "Voice SDR Agent", settingsName: "Voice SDR Agent",
      description: "Handles narrow, scripted voice calls for qualified prospects. Limited to approved call flows.",
      enabled: false, disabledBy: "Priya S.", disabledTs: hrs(2),
      versions: [
        V("v1.2", "JD", "Sep 9", "active", "You are the Voice SDR agent. Follow the approved call script exactly, confirm the prospect's identity, and offer to schedule a meeting. Never discuss pricing on a call; hand off to a human instead.", "JD", days(10)),
        V("v1.1", "JD", "Aug 28", "archived", "You are the Voice SDR agent. Follow the approved call script and offer to schedule a meeting.", null, null),
      ], overrides: [] },
  ];

  const channels = [
    { key: "email", label: "Email", note: "Applies across all campaigns", enabled: true, pausedTs: null },
    { key: "linkedin", label: "LinkedIn", note: "Simulated channel, applies across all campaigns", enabled: true, pausedTs: null },
    { key: "sms", label: "SMS", note: "Applies across all campaigns", enabled: true, pausedTs: null },
    { key: "voice", label: "Voice", note: "Applies across all campaigns", enabled: false, pausedTs: hrs(2) },
  ];

  const suppression = [
    { id: "x1", contact: "legal@fleetwise.io", reason: "Requested no further contact", added: "Sep 12" },
    { id: "x2", contact: "*@existing-customer.com", reason: "Existing customer — expansion team owns relationship", added: "Sep 8" },
    { id: "x3", contact: "competitorcorp.com", reason: "Competitor domain", added: "Sep 3" },
  ];

  // Honest defaults: only what is actually wired up is shown as connected. DronaHQ agents run through their webhook
  // adapter, but the webhook does not return the agent's output, so decisions come from Gemini.
  const integrations = ["Gemini", "Local embeddings (RAG)", "DronaHQ Agentic AI", "Gmail API", "Twilio", "Apollo"].map((name) => ({
    name, connected: name === "Gemini" || name === "Local embeddings (RAG)",
  }));

  // Every campaign starts pinned to the prompt versions that are active now, with its own system prompt.
  for (const c of campaigns) initCampaignPrompts(c, agents);

  // Sales representatives. A campaign sends as one of the reps assigned to it, within that rep's channels, hours and limit.
  const reps = [
    { id: "r_priya", name: "Priya S.", email: "priya@nimbusguard.example", channels: ["email", "linkedin", "sms"], dailyLimit: 25, workingHours: "9:00 AM – 6:00 PM", status: "active", offboardedTs: null },
    { id: "r_rohit", name: "Rohit K.", email: "rohit@nimbusguard.example", channels: ["email", "linkedin", "voice"], dailyLimit: 25, workingHours: "9:00 AM – 6:00 PM", status: "active", offboardedTs: null },
    { id: "r_jd", name: "JD", email: "jd@nimbusguard.example", channels: ["email", "linkedin", "sms", "voice"], dailyLimit: 30, workingHours: "8:00 AM – 8:00 PM", status: "active", offboardedTs: null },
  ];
  const repsFor = { c_us_saas: ["r_priya", "r_rohit"], c_india_bfsi: ["r_rohit", "r_jd"], c_ai_founders: ["r_priya", "r_jd"] };
  for (const c of campaigns) c.repIds = repsFor[c.id] || [];

  return {
    version: SCHEMA_VERSION,
    seq: 100,
    tickCount: 0,
    killSwitch: { active: false, at: null },
    weekly: { prospects: 340, meetings: 9 },
    campaigns,
    reps,
    prospects,
    events,
    decisions,
    approvals,
    agents,
    channels,
    suppression,
    integrations,
  };
}
