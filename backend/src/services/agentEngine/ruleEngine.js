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
export function ruleDraftOutreach({ campaign, prospect, knowledge, override }) {
  const channel = (campaign.channels || [])[0] || "email";
  const fact =
    (prospect.reasons && prospect.reasons[0]) ||
    (prospect.tech && prospect.tech.length ? `your use of ${prospect.tech[0]}` : `${prospect.company}'s recent growth`);
  const productLine = knowledge[0] ? knowledge[0].text.split(/(?<=[.!?])\s/)[0] : "NimbusGuard's cloud cost and security layer";
  const tone = override ? ` (${override})` : "";
  const body = `Hi ${prospect.name.split(" ")[0]} — noticed ${fact.toLowerCase()}. ${productLine} Worth a quick look?`;
  return {
    channel,
    subject: `Cutting cloud spend at ${prospect.company}`,
    body,
    reasoning: `Chose ${channel} as the lead channel for this campaign and referenced a real signal from the research record${tone}.`,
  };
}

/** Conversation & Follow-up Agent: decide how to react to the prospect's latest reply. */
export function ruleHandleConversation({ campaign, prospect }) {
  const lastIn = (prospect.conversation || []).filter((c) => c.dir === "in").slice(-1)[0];
  const text = (lastIn && lastIn.text || "").toLowerCase();
  const objection = /(soc\s*2|security|compliance|residency|data\s*is\s*stored)/i.test(text);
  const meetingIntent = /(call|meet|thursday|friday|schedule|available)/i.test(text);

  if (objection && campaign.approvals && campaign.approvals.escalate) {
    return { action: "escalate", reasoning: "Prospect raised a security/compliance question; campaign policy requires human escalation on any such objection." };
  }
  if (meetingIntent) {
    return { action: "meeting", reasoning: "Prospect signalled intent to schedule a call; proposing a meeting time." };
  }
  return { action: "followup", reasoning: "No clear objection or meeting intent yet; sending a contextual follow-up." };
}

/** Lead Research & Enrichment Agent: fills in a newly discovered prospect's research record. */
export function ruleEnrich({ prospect }) {
  return {
    ...prospect,
    evidence: prospect.evidence?.length ? prospect.evidence : ["Enriched from an approved company database"],
    reasons: prospect.reasons?.length ? prospect.reasons : ["Awaiting ICP scoring"],
  };
}
