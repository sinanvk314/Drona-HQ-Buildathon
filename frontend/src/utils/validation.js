// Pure validation helpers shared by the forms and the service layer.

export function validateCampaign(v, launch) {
  const e = {};
  if (!v.name || v.name.trim().length < 3) e.name = "Enter a campaign name (at least 3 characters).";
  if (!launch) return e;
  if (v.mode === "single") {
    // One named person instead of an audience: no ICP, region, roles or qualification score to define.
    if (!v.objective || !v.objective.trim()) e.objective = "Enter the campaign objective.";
    if (!v.offer || !v.offer.trim()) e.offer = "Describe what this campaign offers.";
    if (!v.target || !v.target.name || !v.target.name.trim()) e.targetName = "Enter the person's name.";
    if (!v.target || !v.target.organisation || !v.target.organisation.trim()) e.targetOrganisation = "Enter their organisation.";
    if (!v.channels || !v.channels.length) e.channels = "Select at least one channel.";
    return e;
  }
  if (!v.description || !v.description.trim()) e.description = "Add a short description.";
  if (!v.owner || !v.owner.trim()) e.owner = "Enter an owner.";
  if (!v.objective || !v.objective.trim()) e.objective = "Enter the campaign objective.";
  if (!v.icpText || !v.icpText.trim()) e.icpText = "Describe the target audience.";
  if (!v.geography || !v.geography.length) e.geography = "Select at least one geography.";
  if (!v.personas || !v.personas.length) e.personas = "Select at least one persona.";
  if (!v.channels || !v.channels.length) e.channels = "Select at least one channel.";
  if (!v.qualificationPrompt || !v.qualificationPrompt.trim()) {
    e.qualificationPrompt = "Add the qualification criteria.";
  }
  const n = Number(v.dailyLimit);
  if (!Number.isFinite(n) || n < 1 || n > 1000) e.dailyLimit = "Enter a number between 1 and 1000.";
  if (!v.workingHours || !v.workingHours.trim()) e.workingHours = "Enter working hours.";
  return e;
}

export function validateSuppression(v) {
  const e = {};
  const contact = (v.contact || "").trim();
  if (!contact) e.contact = "Enter an email address or domain.";
  else if (/\s/.test(contact) || !contact.includes(".")) e.contact = "Enter a valid email address or domain, e.g. name@company.com or company.com.";
  if (!(v.reason || "").trim()) e.reason = "Enter a reason.";
  return e;
}
