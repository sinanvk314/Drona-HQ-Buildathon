# ICP Fitment Agent — complete setup note

No secrets in this file. Do not paste webhook URLs or API keys into it (or into any chat); they go in `backend/.env`.

## 0. Why this exists
The agent's current Instructions are generic boilerplate: they never mention the webhook input, give no scoring rule, and never ask for JSON. So the agent replies in prose ("no specific request… could you clarify?"). The text in section 1 fixes that. It matches exactly what the backend's DronaHQ engine sends (`backend/src/services/agentEngine/dronahqEngine.js`).

Do these in order: **1 Instructions, 2 Variables, 3 Response type + schema, 4 Save & Publish, 5 Playground test, 6 Postman test.**

---

## 1. Instructions — paste everything inside the block into the agent's Instructions tab, replacing what is there

```
Role: You are the ICP Fitment Agent in an autonomous SDR pipeline. You judge whether ONE prospect fits a campaign's Ideal Customer Profile. You do not write messages, contact anyone, or notify anyone.

INPUT (JSON, delivered by the webhook): {{body}}
It contains: person, company, campaign (icp, company_criteria, exclusion_criteria, qualification_prompt, personas, geography), dossier (entries written by earlier agents), knowledge (retrieved documents), and optionally instruction and campaign_override.

Campaign guardrails: {{GUARDRAILS}}
Escalation rules: {{ESCALATION_RULES}}

How to decide:
1. Read the whole dossier first. Earlier entries are evidence. Do not re-run any conflict or suppression check; use what the dossier already says.
2. Score 0-100 against campaign.icp using: role and persona match (0-35), company size and industry fit (0-30), buying signals (0-25), and how well the dossier corroborates the picture (0-10).
3. If ANY item in campaign.exclusion_criteria applies (for example the prospect is already a customer, a competitor, or was contacted by another campaign recently), the decision is "Rejected" no matter what the score is.
4. Follow campaign.qualification_prompt for the qualify threshold. If it states none, qualify at 70 or above.
5. Use only facts that appear in the input. If a fact is missing, say it is unknown. Never invent employee counts, funding, titles, tech stack, or news.
6. The decision is exactly one of: "Qualified", "Rejected", "Escalate". Use "Escalate" only when a critical fact is missing or the case is genuinely ambiguous. Even then, give your best-estimate fit_score as an integer.

Output: ONLY one JSON object. No text before or after it, and no markdown code fence.
{
  "agent_name": "ICP Fitment Agent",
  "harness_version": "icp-v1",
  "decision": "Qualified" | "Rejected" | "Escalate",
  "qualified": true | false,
  "fit_score": <integer 0-100>,
  "score": <the same integer>,
  "reasoning": "<2-3 sentences>",
  "reasons": ["<short reason>", "..."],
  "evidence": ["<a fact from the input that supports the decision>", "..."],
  "retrieved_knowledge": ["<label of any knowledge document you used>"],
  "campaign_instruction_excerpt": "<the ICP or criteria text you applied>",
  "conflict_check": "<what the dossier says about conflicts, or 'not in dossier'>",
  "final_action": "advance_to_outreach" | "close_prospect" | "escalate_to_human",
  "handoff_note": "<1-2 sentences in plain SDR voice for the next agent>"
}
Rules for the object: "qualified" is true only when decision is "Qualified". final_action is advance_to_outreach for Qualified, close_prospect for Rejected, escalate_to_human for Escalate. If the input is empty or malformed, return the same object with decision "Escalate", fit_score 0, qualified false, and the problem stated in evidence.
```

Notes on that text:
- **Everything after "Role:" is the instruction.** Do not keep any of the old generic lines (tone, "approachable", "notify the SDR manager", "alert technical support"). The agent cannot do those things and they push it toward prose.
- **Removed on purpose:** the old guardrail "never disclose prospect information". The agent has to cite prospect facts as evidence.
- `fit_score` and `score` are duplicated deliberately. The backend accepts either name.
- The scoring split (35/30/25/10) and the 70 threshold are proposals. Change them if the team's rubric differs, but keep the output format identical.

## 2. Variables
`{{GUARDRAILS}}` and `{{ESCALATION_RULES}}` only work if they are **defined in the agent's Variables tab**. If they are not defined, DronaHQ leaves the literal text `{{GUARDRAILS}}` in the prompt (the same silent failure the old `//VAR//` syntax caused). Two options:
- Define both variables and give them values (for example the campaign's guardrail and escalation text), or
- Delete those two lines from the Instructions.

Syntax reminder: DronaHQ uses `{{NAME}}` for variables and `{{body.key}}` for webhook data. Never `//NAME//`.

## 3. Trigger response type + schema
Agent → Triggers → Webhook:
- **Response: Standard.** (The docs also list Stream, marked "coming soon", and None. Do not use None.)
- **Response schema.** DronaHQ's editor rejected a plain, standards-valid schema that had no `$schema`, `title` or `additionalProperties`, so it checks more than the standard does. Do not hand-type or edit the schema; paste one of the ready-made files, whole, exactly as it is (they are raw JSON: no markdown, no code fence). They are in `docs\dronahq\schemas\`:
  1. `icp-schema-A-try-first.json`: keeps the three metadata keys your editor accepted before, but uses `number` instead of `integer`, drops `minimum`/`maximum`, and requires all 14 fields. **Try this first.**
  2. `icp-schema-C-loosest.json`: only `decision` and `fit_score`, still with the metadata keys. Use it if A saves but `response` stays `null`, to test whether the strictness is the problem.
  3. `icp-schema-B-original-accepted.json`: the schema that was accepted originally (`integer` + min/max). Restore it if you need to get back to a known state.

  How to copy one: in CMD run `notepad C:\Users\SINAN\Desktop\Drona-HQ-Buildathon\docs\dronahq\schemas\icp-schema-A-try-first.json`, press Ctrl+A then Ctrl+C, and paste into the Response schema box. Change ONE thing at a time, then rerun the test script.

  Why A: the docs' supported-feature list mentions `number` but not `integer`, and does not mention `minimum`/`maximum`, so those two are the suspects for the empty `response`. That is a theory, not a confirmed cause.

Also on that trigger: **Generate API Key** and copy it once (it is shown only once). The key goes in the `api-key` header. It is NOT `Authorization: Bearer`.

## 4. Save & Publish
The webhook runs the **published** version. Editing without publishing changes nothing for webhook calls.

## 5. Test in Playground first
Paste the JSON below as the message. Expected: a bare JSON object with `"decision": "Qualified"`. If Playground answers in prose, the Instructions did not save or `{{body}}` is not being resolved. Fix that before touching Postman.

All four tests use the same campaign (the seeded "US SaaS CTO Outreach" from the backend). Each payload below is complete: copy it as-is.

### Test A — should be Qualified (score roughly 80+)
```json
{
  "person": { "name": "Dana Whitfield", "title": "CTO", "email": "dana@cloudpeak.example" },
  "company": { "name": "CloudPeak Systems", "industry": "SaaS", "size": "220 employees", "funding": "Series A, $12M raised", "tech": ["AWS", "Kubernetes"], "city": "Austin, TX" },
  "campaign": { "id": "c_us_saas", "name": "US SaaS CTO Outreach", "icp": "CTO or VP Engineering at a US SaaS company with 50–500 employees and a recent cloud-cost signal.", "company_criteria": "50–500 employees · SaaS · Hiring platform or infra roles", "exclusion_criteria": "Already a customer · Competitor · Contacted by another campaign in last 14 days", "qualification_prompt": "Qualify if the company is hiring cloud-cost or platform roles OR has raised in the last 12 months, and the contact is a CTO or VP Engineering. Qualify at 70 or above.", "personas": ["CTO", "VP Engineering"], "geography": ["United States"], "channels": ["email", "linkedin"] },
  "dossier": [ { "agent_name": "Lead Research & Enrichment Agent", "decision": "Ready for Fitment", "evidence": ["Title confirmed as CTO", "Hiring a Platform Engineer and a FinOps lead"], "conflict_check": "No conflict, not active in another campaign", "handoff_note": "Confirmed CTO at a growing SaaS company that is hiring platform roles." } ],
  "knowledge": []
}
```

### Test B — should be Rejected (low score: wrong role, far too small)
```json
{
  "person": { "name": "Sam Ortiz", "title": "Marketing Manager", "email": "sam@tinyloop.example" },
  "company": { "name": "TinyLoop", "industry": "SaaS", "size": "8 employees", "funding": "Pre-seed", "tech": ["GCP"], "city": "Denver, CO" },
  "campaign": { "id": "c_us_saas", "name": "US SaaS CTO Outreach", "icp": "CTO or VP Engineering at a US SaaS company with 50–500 employees and a recent cloud-cost signal.", "company_criteria": "50–500 employees · SaaS · Hiring platform or infra roles", "exclusion_criteria": "Already a customer · Competitor · Contacted by another campaign in last 14 days", "qualification_prompt": "Qualify if the company is hiring cloud-cost or platform roles OR has raised in the last 12 months, and the contact is a CTO or VP Engineering. Qualify at 70 or above.", "personas": ["CTO", "VP Engineering"], "geography": ["United States"], "channels": ["email", "linkedin"] },
  "dossier": [],
  "knowledge": []
}
```

### Test C — should be Rejected because of an exclusion, even though the profile looks strong
```json
{
  "person": { "name": "Priya Nair", "title": "VP Engineering", "email": "priya@datalane.example" },
  "company": { "name": "Datalane", "industry": "SaaS", "size": "300 employees", "funding": "Series B, $30M raised", "tech": ["AWS"], "city": "New York, NY" },
  "campaign": { "id": "c_us_saas", "name": "US SaaS CTO Outreach", "icp": "CTO or VP Engineering at a US SaaS company with 50–500 employees and a recent cloud-cost signal.", "company_criteria": "50–500 employees · SaaS · Hiring platform or infra roles", "exclusion_criteria": "Already a customer · Competitor · Contacted by another campaign in last 14 days", "qualification_prompt": "Qualify if the company is hiring cloud-cost or platform roles OR has raised in the last 12 months, and the contact is a CTO or VP Engineering. Qualify at 70 or above.", "personas": ["CTO", "VP Engineering"], "geography": ["United States"], "channels": ["email", "linkedin"] },
  "dossier": [ { "agent_name": "Lead Research & Enrichment Agent", "decision": "Ready for Fitment", "evidence": ["Datalane is already a paying customer"], "conflict_check": "Existing customer", "handoff_note": "Strong profile, but the company is already a customer." } ],
  "knowledge": []
}
```

### Test D — should be Escalate (critical facts missing); fit_score must still be an integer
```json
{
  "person": { "name": "Jordan Lee", "title": null, "email": "jordan@northgate.example" },
  "company": { "name": "Northgate", "industry": null, "size": null, "funding": null, "tech": [], "city": null },
  "campaign": { "id": "c_us_saas", "name": "US SaaS CTO Outreach", "icp": "CTO or VP Engineering at a US SaaS company with 50–500 employees and a recent cloud-cost signal.", "company_criteria": "50–500 employees · SaaS · Hiring platform or infra roles", "exclusion_criteria": "Already a customer · Competitor · Contacted by another campaign in last 14 days", "qualification_prompt": "Qualify if the company is hiring cloud-cost or platform roles OR has raised in the last 12 months, and the contact is a CTO or VP Engineering. Qualify at 70 or above.", "personas": ["CTO", "VP Engineering"], "geography": ["United States"], "channels": ["email", "linkedin"] },
  "dossier": [],
  "knowledge": []
}
```
## 6. Test through the webhook (Postman)
- Method **POST**, URL = the agent's webhook URL, header `api-key: <the key from step 3>`, body **raw JSON** (one of the tests above), request timeout **120 s** (the docs give no timeout).
- Expected: `"success": true`, `"message": "Agent run completed successfully…"`, and `"response"` containing the decision JSON (a JSON string, or an object if the Standard schema applies).
- Note how long the call takes. If a call takes tens of seconds, every backend scheduler tick slows down.

## 7. Then run it through the real backend engine
In `backend/.env` (on the `integration` branch):
```
AGENT_ENGINE=dronahq
DRONAHQ_WEBHOOK_ICP=<the webhook url>
DRONAHQ_API_KEY_ICP=<the key>
DRONAHQ_FALLBACK=none
```
`DRONAHQ_FALLBACK=none` matters while testing: with the default (`rule`), a failed DronaHQ call silently falls back to the rule engine and you cannot tell. Then `npm start` and open `http://localhost:8080/health`. It must show `"agentEngine":"dronahq"` and `"icp": true`.

## 8. If it still answers in prose
1. **Traces** (DronaHQ keeps every run's input and output for 90 days): open the failed run and read the prompt the agent actually received. If you see the literal text `{{body}}` or `{{GUARDRAILS}}`, the variable did not resolve.
2. Confirm you **published**, not just saved.
3. Confirm the Instructions contain `INPUT (JSON, delivered by the webhook): {{body}}` and nothing from the old boilerplate.
4. Confirm the webhook you are calling belongs to **this** agent (a duplicate or Artisan-regenerated copy has its own URL).
5. Confirm Response is **Standard**, not None.
6. If Playground works but the webhook does not, the problem is the trigger or the published version, not the Instructions.

## 9. What the backend does with the answer
- It parses `response` as JSON (a ```json fence or a sentence around the object is tolerated). Prose fails as an error.
- `decision` "Qualified" → prospect moves to qualified; "Rejected" → rejected. "Escalate" is recorded as not-qualified with the reasoning prefixed `[Agent escalated]`, because the backend has no escalate path for ICP yet.
- `fit_score` / `score` is required as an integer. Missing score = failure.
- Failures fall back to the rule engine unless `DRONAHQ_FALLBACK=none`.
