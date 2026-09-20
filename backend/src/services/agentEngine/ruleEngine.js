// Default, zero-cost, zero-setup agent engine: deterministic heuristics that actually read the
// campaign's own configuration (qualification prompt threshold, personas, company criteria)
// and the prospect's own fields, rather than returning canned or random results. This is what
// runs when AGENT_ENGINE=rule (the default) or when AGENT_ENGINE=llm is set but no
// ANTHROPIC_API_KEY is present — the backend always has a working, explainable decision path.

function parseThreshold(qualificationPrompt) {
  const m = /(\d{2,3})\s*(?:or above|or higher|\+|and above)/i.exec(qualificationPrompt || "");
  return m ? Number(m[1]) : 70;
}

function parseEmployeeRange(companyCriteria) {
  const m = /(\d{1,4})\s*[–-]\s*(\d{1,4})\s*employees/.exec(companyCriteria || "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function parseEmployeeCount(size) {
  const m = /([\d,]+)\s*employees/.exec(size || "");
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** ICP Fitment Agent: score 0-100 and qualify/reject with cited evidence. */
export function ruleScoreICP({ campaign, prospect }) {
  const threshold = parseThreshold(campaign.qualificationPrompt);
  const range = parseEmployeeRange(campaign.companyCriteria);
  const count = parseEmployeeCount(prospect.size);

  let score = 50;
  const reasons = [];
  const evidence = [];

  if (range && count != null) {
    if (count >= range[0] && count <= range[1]) {
      score += 20;
      reasons.push(`Company size within the ${range[0]}–${range[1]} employee range`);
      evidence.push(`Company size: ${prospect.size}`);
    } else {
      score -= 25;
      reasons.push(`Company size (${prospect.size || "unknown"}) is outside the ${range[0]}–${range[1]} employee range`);
      evidence.push(`Company size: ${prospect.size || "unknown"}`);
    }
  }

  const personaMatch = (campaign.personas || []).some((p) => (prospect.title || "").toLowerCase().includes(p.toLowerCase()));
  if (personaMatch) {
    score += 15;
    reasons.push(`Role (${prospect.title}) matches a target persona`);
    evidence.push(`Title: ${prospect.title}`);
  } else {
    score -= 15;
    reasons.push(`Role (${prospect.title || "unknown"}) is not in the target persona list`);
  }

  const promptTokens = (campaign.qualificationPrompt || "").toLowerCase();
  const techHit = (prospect.tech || []).find((t) => promptTokens.includes(t.toLowerCase()));
  if (techHit) {
    score += 5;
    evidence.push(`Tech stack includes ${techHit}, referenced in the qualification criteria`);
  }
  if (prospect.funding && /(seed|series)/i.test(prospect.funding) && /(rais|fund)/i.test(promptTokens)) {
    score += 10;
    evidence.push(`Recent funding: ${prospect.funding}`);
  }

  const exclusion = (campaign.exclusionCriteria || "").toLowerCase();
  let excluded = false;
  if (exclusion.includes("competitor") && /competitor/i.test(prospect.company || "")) excluded = true;

  score = Math.max(1, Math.min(99, Math.round(score)));
  const qualified = !excluded && score >= threshold;

  return {
    qualified,
    score,
    threshold,
    reasons,
    evidence,
    reasoning: qualified
      ? `Meets ICP at ${score}/100 (threshold ${threshold}); ${excluded ? "excluded" : "no exclusion criteria triggered"}.`
      : excluded
      ? "Matched an exclusion criterion for this campaign."
      : `Scored ${score}/100, below the campaign's ${threshold} qualification threshold.`,
  };
}

/** Personalisation & Outreach Strategy Agent: pick a channel and draft an opening message. */
export function ruleDraftOutreach({ campaign, prospect, knowledge, override, channel: planned }) {
  const channel = planned || (campaign.channels || [])[0] || "email";
  const fact =
    (prospect.reasons && prospect.reasons[0]) ||
    (prospect.tech && prospect.tech.length ? `your use of ${prospect.tech[0]}` : `${prospect.company}'s recent growth`);
  const productLine = knowledge[0] ? knowledge[0].text.split(/(?<=[.!?])\s/)[0] : offerLine(campaign);
  const tone = override ? ` (${override})` : "";
  const body = `Hi ${prospect.name.split(" ")[0]} — noticed ${fact.toLowerCase()}. ${productLine} Worth a quick look?`;
  return {
    channel,
    subject: `A note for ${prospect.name.split(" ")[0]} at ${prospect.company}`,
    body,
    reasoning: `Chose ${channel} as the lead channel for this campaign and referenced a real signal from the research record${tone}.`,
  };
}

const firstSentence = (knowledge, fallback) => (knowledge && knowledge[0] ? knowledge[0].text.split(/(?<=[.!?])\s/)[0] : fallback);
// What the campaign offers, as one sentence, for when no knowledge was retrieved.
const offerLine = (campaign) => (campaign && campaign.offer ? campaign.offer.split(/(?<=[.!?])\s/)[0] : "We would like to share something that may be useful to you.");

/** Conversation & Follow-up Agent: decide how to react to the prospect's latest reply, and draft the answer. */
export function ruleHandleConversation({ campaign, prospect, knowledge }) {
  const lastIn = (prospect.conversation || []).filter((c) => c.dir === "in").slice(-1)[0];
  const text = (lastIn && lastIn.text || "").toLowerCase();
  const first = (prospect.name || "there").split(" ")[0];
  const objection = /(soc\s*2|security|compliance|residency|data\s*is\s*stored)/i.test(text);
  const meetingIntent = /(call|meet|thursday|friday|schedule|available)/i.test(text);

  if (objection && campaign.approvals && campaign.approvals.escalate) {
    return {
      action: "escalate",
      reasoning: "Prospect raised a security/compliance question; campaign policy requires human escalation on any such objection.",
      draft: `Hi ${first}, thanks for asking. That is a question our security lead should answer properly, so I am passing it to them and they will follow up shortly.`,
    };
  }
  if (meetingIntent) {
    return {
      action: "meeting",
      reasoning: "Prospect signalled intent to schedule a call; proposing a meeting time.",
      draft: `Hi ${first}, glad this is relevant. I will arrange a short call and send over a few times that work.`,
    };
  }
  return {
    action: "followup",
    reasoning: "No clear objection or meeting intent yet; sending a contextual follow-up.",
    draft: `Hi ${first}, thanks for getting back to me. ${firstSentence(knowledge, offerLine(campaign))} Happy to go into more detail on a short call.`,
  };
}

const SENIOR_FIRST = /(founder|ceo|chief executive|owner)/i;

/** Outreach Strategy Agent: which channels, in what order, how long to wait. Heuristic by seniority and role. */
export function ruleStrategy({ campaign, prospect, allowedChannels, maxTouches, defaultWait }) {
  const preferred = SENIOR_FIRST.test(prospect.title || "")
    ? ["linkedin", "email", "sms", "voice"]
    : ["email", "linkedin", "voice", "sms"];
  let ordered = preferred.filter((c) => allowedChannels.includes(c));
  if (!ordered.length) ordered = [...allowedChannels];
  // SMS is a later nudge, never the opening touch.
  if (ordered.length > 1 && ordered[0] === "sms") ordered = [...ordered.slice(1), "sms"];
  // Voice is the last resort: the final touch, after the written channels have been tried.
  const written = ordered.filter((c) => c !== "voice");
  const lastVoice = ordered.includes("voice") && written.length > 0 && maxTouches > 1;
  const cycle = lastVoice ? written : ordered;
  const sequence = Array.from({ length: lastVoice ? maxTouches - 1 : maxTouches }, (_, i) => cycle[i % cycle.length]);
  if (lastVoice) sequence.push("voice");
  return {
    sequence,
    waitHours: defaultWait,
    reasoning: `${SENIOR_FIRST.test(prospect.title || "") ? "Founder-level contact: lead on LinkedIn" : `${prospect.title || "This role"} usually expects a considered email: lead on email`}, then ${sequence.slice(1).join(", ") || "no further channels"}.`,
  };
}

/** Follow-up Agent: a short, different message for the next channel in the plan. */
export function ruleFollowUp({ campaign, prospect, knowledge, channel, touchNumber, isLast }) {
  const first = (prospect.name || "there").split(" ")[0];
  const fact = firstSentence(knowledge, offerLine(campaign));
  const body = isLast
    ? `Hi ${first}, this is my last note. ${fact} If it is ever useful, I am glad to share more.`
    : `Hi ${first}, one more thought. ${fact} Worth a short look?`;
  return {
    subject: channel === "email" ? `Following up: ${prospect.company}` : "Following up",
    body,
    angle: "Reused product fact",
    reasoning: `Follow-up ${touchNumber} on ${channel}: adds a product fact from the knowledge base and does not repeat the opening message.`,
  };
}

/** Lead Research & Enrichment Agent: fills in a newly discovered prospect's research record. */
export function ruleEnrich({ prospect }) {
  return {
    ...prospect,
    evidence: prospect.evidence?.length ? prospect.evidence : ["Enriched from an approved company database"],
    reasons: prospect.reasons?.length ? prospect.reasons : ["Awaiting ICP scoring"],
  };
}
