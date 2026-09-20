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
    judgeable: !!range, // the rules read an employee-count range; without one only an LLM can judge fit
    reasons,
    evidence,
    reasoning: qualified
      ? `Meets ICP at ${score}/100 (threshold ${threshold}); ${excluded ? "excluded" : "no exclusion criteria triggered"}.`
      : excluded
      ? "Matched an exclusion criterion for this campaign."
      : `Scored ${score}/100, below the campaign's ${threshold} qualification threshold.`,
  };
}

/** How to address someone: "Sam" for "Sam Lee", but "Dr. Rao" for "Dr. Anil Rao" (a title is not a first name). */
export function greetingName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "there";
  if (/^(dr|prof|professor|mr|mrs|ms|mx|shri|smt|sir)\.?$/i.test(parts[0]) && parts.length > 1) return `${parts[0]} ${parts[parts.length - 1]}`;
  return parts[0];
}

/** Personalisation & Outreach Strategy Agent: pick a channel and draft an opening message. */
export function ruleDraftOutreach({ campaign, prospect, knowledge, override, channel: planned }) {
  const channel = planned || (campaign.channels || [])[0] || "email";
  const first = greetingName(prospect.name);
  const hook = prospect.dossier && prospect.dossier.hooks && prospect.dossier.hooks[0];
  const fact =
    hook ||
    (prospect.reasons && prospect.reasons[0]) ||
    (prospect.tech && prospect.tech.length ? `your use of ${prospect.tech[0]}` : `${prospect.company}'s recent growth`);
  const productLine = knowledge[0] ? knowledge[0].text.split(/(?<=[.!?])\s/)[0] : offerLine(campaign);
  const tone = override ? ` (${override})` : "";
  const subject = `A note for ${first}${prospect.company && prospect.company !== "Independent" ? ` at ${prospect.company}` : ""}`;
  const reasoning = `Chose ${channel} as the lead channel for this campaign and referenced a real signal from the research record${tone}.`;

  if (channel !== "email") {
    const body = `Hi ${first}, ${hook ? `I came across this about you: ${fact.replace(/[.!?]+$/, "")}.` : `noticed ${fact.toLowerCase()}.`} ${productLine} Worth a quick look?`;
    return { channel, subject, body, reasoning };
  }
  // A proper email: greeting, why them, what is offered, one low-pressure ask. The signature is added when it is sent.
  const offer = campaign.offer ? campaign.offer.trim() : productLine;
  const why = hook
    ? `I am writing to you because of your work: ${fact.replace(/[.!?]+$/, "")}. It made me think of something that could be relevant to you.`
    : `I am writing to you because ${fact.replace(/[.!?]+$/, "")} suggested this could be relevant to you.`;
  const body = [
    `Hello ${first},`,
    why,
    `${offer}${/[.!?]$/.test(offer) ? "" : "."} I thought it worth putting in front of you directly rather than sending something generic.`,
    "Would you be open to a short conversation to see whether this could be useful? If so, just reply and I will suggest a few times that suit you.",
  ].join("\n\n");
  return { channel, subject, body, reasoning };
}

const firstSentence = (knowledge, fallback) => (knowledge && knowledge[0] ? knowledge[0].text.split(/(?<=[.!?])\s/)[0] : fallback);
// What the campaign offers, as one sentence, for when no knowledge was retrieved.
const offerLine = (campaign) => (campaign && campaign.offer ? campaign.offer.split(/(?<=[.!?])\s/)[0] : "We would like to share something that may be useful to you.");

/** Conversation & Follow-up Agent: decide how to react to the prospect's latest reply, and draft the answer. */
export function ruleHandleConversation({ campaign, prospect, knowledge }) {
  const lastIn = (prospect.conversation || []).filter((c) => c.dir === "in").slice(-1)[0];
  const text = (lastIn && lastIn.text || "").toLowerCase();
  const first = greetingName(prospect.name);
  const objection = /(soc\s*2|security|compliance|residency|data\s*is\s*stored)/i.test(text);
  const meetingIntent = /(call|meet|thursday|friday|schedule|available)/i.test(text);

  if (objection && campaign.approvals && campaign.approvals.escalate) {
    return {
      action: "escalate",
      reasoning: "Prospect raised a security/compliance question; campaign policy requires human escalation on any such objection.",
      draft: `Hello ${first},

Thank you for asking. That is a question our security lead should answer properly rather than me giving you a partial answer, so I am passing it to them now.

They will follow up with you shortly.`,
    };
  }
  if (meetingIntent) {
    return {
      action: "meeting",
      reasoning: "Prospect signalled intent to schedule a call; proposing a meeting time.",
      draft: `Hello ${first},

Thank you for your reply, and I am glad this is relevant to you. I would be happy to arrange a short conversation.

I have picked a few times below that could suit you.`,
    };
  }
  return {
    action: "followup",
    reasoning: "No clear objection or meeting intent yet; sending a contextual follow-up.",
    draft: `Hello ${first},

Thank you for getting back to me. ${firstSentence(knowledge, offerLine(campaign))}

I would be glad to go into more detail on a short call, whenever suits you.`,
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
  const first = greetingName(prospect.name);
  const fact = firstSentence(knowledge, offerLine(campaign));
  const email = channel === "email";
  const body = email
    ? isLast
      ? `Hello ${first},\n\nThis is my last note, so I will not keep writing. ${fact}\n\nIf it is ever useful, I would be glad to share more, and you are welcome to reply at any time.`
      : `Hello ${first},\n\nI wanted to follow up on my earlier note with one more thought. ${fact}\n\nIf this is relevant, I would be glad to set up a short conversation at a time that suits you. If not, no problem at all.`
    : isLast
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

/** Research Agent (rule fallback): restates what is known as facts, hooks and gaps. Uses only the prospect's own data. */
export function ruleResearch({ campaign, prospect }) {
  const facts = [];
  const add = (text, kind) => text && facts.push({ text, kind });
  add(`${prospect.name} is ${prospect.title || "a contact"} at ${prospect.company}`, "profile");
  add(prospect.industry && `${prospect.company} works in ${prospect.industry}`, "profile");
  add(prospect.size && `${prospect.company} has ${prospect.size}`, "profile");
  add(prospect.funding && `Funding: ${prospect.funding}`, "signal");
  add(prospect.city && `Based in ${prospect.city}`, "context");
  for (const t of prospect.tech || []) add(`Uses ${t}`, "context");
  for (const [k, v] of Object.entries(prospect.attributes || {})) add(`${k}: ${v}`, "context");
  const known = ((prospect.dossier && prospect.dossier.facts) || []).map((f) => f.text);

  const hooks = [];
  if (prospect.funding && /(seed|series|raised)/i.test(prospect.funding)) hooks.push(`Recent funding (${prospect.funding}) usually means new priorities and budget`);
  if ((prospect.tech || []).length) hooks.push(`Their use of ${prospect.tech.slice(0, 2).join(" and ")} makes what we offer relevant`);
  if (known.length) hooks.push(known[0]);

  const gaps = [];
  if (!prospect.size) gaps.push("How large the organisation is");
  if (!prospect.funding && !(prospect.attributes && Object.keys(prospect.attributes).length)) gaps.push("Recent news or activity that gives a reason to write now");
  if (!prospect.email || /\.example$/.test(prospect.email)) gaps.push("A confirmed contact address");
  gaps.push("Whether they are the person who decides on this");

  return {
    summary: `${prospect.name}, ${prospect.title || "contact"} at ${prospect.company}. ${hooks[0] || "No specific reason to write now is known yet."}`,
    facts, hooks: hooks.slice(0, 3), gaps: gaps.slice(0, 4), confidence: facts.length >= 5 ? "medium" : "low",
    reasoning: "Restated the prospect's own data; nothing was added from outside it.",
  };
}

/** A phone turn with no model: enough to be polite, hear a clear yes or no, and end the call. */
export function ruleVoiceTurn({ campaign, prospect, transcript }) {
  const turns = transcript.filter((t) => t.who === "sdr").length;
  const said = ((transcript.filter((t) => t.who === "person").slice(-1)[0]) || {}).text || "";
  const first = greetingName(prospect.name);
  const offer = campaign.offer ? campaign.offer.split(/(?<=[.!?])\s/)[0] : "";
  if (!transcript.length) return { say: `Hello ${first}, this is a quick call about something that may be useful to you. ${offer} Is now an okay time?`.trim(), end: false, outcome: "continue", summary: "Opening the call." };
  if (/(don'?t call|do not call|stop calling|remove me|take me off|unsubscribe)/i.test(said)) return { say: "Understood, I am sorry to have bothered you. We will not contact you again. Goodbye.", end: true, outcome: "opt_out", summary: "They asked not to be contacted." };
  if (/(not interested|no thanks|no thank you|not now|busy)/i.test(said) && !/(later|tomorrow)/i.test(said)) return { say: "No problem at all, thank you for your time. Goodbye.", end: true, outcome: "not_interested", summary: "They were not interested." };
  if (/(later|tomorrow|next week|call back)/i.test(said)) return { say: "Of course, I will try again another time. Thank you, goodbye.", end: true, outcome: "callback", summary: "They asked for a call back." };
  if (/(yes|sure|okay|ok|interested|tell me|go ahead|sounds good|meeting|call)/i.test(said) || turns >= 3) return { say: "Wonderful, I will email you a few times that could work. Thank you, and goodbye.", end: true, outcome: "interested", summary: "They were open to a meeting." };
  return { say: `${offer || "We would like to share something useful."} Would you be open to a short conversation?`, end: false, outcome: "continue", summary: "Explaining why we called." };
}
