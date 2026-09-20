# Demo script and fallback plan

A run-through of about 8 minutes, the checks to do beforehand, and what to do when something breaks. Everything here uses features that exist; the last section says what is simulated so nobody is surprised by a question.

## Before the demo (do this an hour ahead, not live)

1. **Wake the site.** Open the live URL. Render's free tier sleeps after 15 minutes of no traffic and takes about a minute to wake. UptimeRobot pinging `/health` every 5 minutes prevents it.
2. **Three Live campaigns.** The required demonstration needs three or more campaigns running at once. A Completed campaign cannot be resumed, so if the old ones were completed: on each, open the campaign page, click **Duplicate**, then **Launch**. Give each a distinct audience so the differences are visible.
3. **Run the smoke test** from your own machine (it pauses one campaign for the wait time and then resumes it, so never run it during the judged demo):
   ```
   set SMOKE_ACCESS_CODE=<the access code, if you set one>
   node backend\scripts\smoke.mjs https://<your-app>.onrender.com 40
   ```
   Expected: every check passes, ending in "other Live campaign kept running". If it says SKIP for the pause check, fewer than two campaigns are Live.
4. **Check the engine.** Settings, Integrations: Gemini should say Connected. If it says "Not set up" or the Runtime tab (Dev) shows the daily cap reached, decisions are being made by the rule engine (still works, but drafts are plain). Fix the key or wait for the quota reset.
5. **Real email to yourself** (only if you will show it): Dev, Real email, click **1. Test the connection**, then **2. Send a test email** to your own address, and confirm it arrives. Gmail's refresh token expires after 7 days while the Google app is in Testing mode; if the connection test fails with a sign-in error, repeat step 1d of the README to get a new one.
6. **Sign-in.** Set `APP_ACCESS_CODE` and `AUTH_SECRET` on Render so the public site cannot be used by strangers, then sign in once so you know the code.
7. **Clear the noise.** Reject or complete anything left over in Approvals, and archive test campaigns, so the screens show only what you want judges to see.

## The demo (about 8 minutes)

| Min | Show | Say |
|---|---|---|
| 0:00 | **Command Center**: three Live campaigns, funnel numbers, the efficiency panel | "Three campaigns run at once, each with its own audience, prompts and limits. The panel shows what every decision costs." |
| 1:00 | **Pause one campaign**, wait a few seconds, point at the others still moving. Resume it. | "Pausing one never stops the others. There is also an agent-level pause, a channel pause and a global kill switch." |
| 2:00 | **Campaign page, SDR Blueprint**, then one **prospect**: dossier, plan, hand-off notes | "It is one SDR, not seven bots: every agent reads the same dossier and leaves a hand-off note for the next." |
| 3:00 | **Approvals**: open a draft, show the grounding check, approve one | "Nothing customer-facing is sent without a human at the Manual level. Every draft is checked against the knowledge base and blocked if it makes an unsupported claim." |
| 4:00 | **Decision Journal** entry, then **View prompt** on a hand-off note | "Every decision records the exact prompt versions it used, so a result can be traced to a prompt." |
| 4:45 | **Dev, Judge sandbox**: ask a judge for a name and role, create a run, press **Run the SDR**, let the judge type replies. Ask for another time, then pick one. Show the scorecard and download the invite. | "The judge plays the prospect. The SDR reads real replies, proposes real times inside the rep's hours, books one and produces a calendar invite." |
| 6:30 | **Analytics**: campaign health and each agent's success by prompt version | "When a campaign struggles it says why and what to try. We change the prompt, keep the change as a commit with a message, and compare success by version." |
| 7:15 | (Optional) **Real email**: an approved message arriving in your inbox, and your reply appearing on the prospect | "Real campaigns use only contacts we entered and always wait for approval." |
| 7:45 | **Settings**: what is really connected | "We show what is real and what is simulated." |

If you only have five minutes, drop the Decision Journal, Analytics and the optional real email.

## When something breaks

| Symptom | What to do |
|---|---|
| Site is slow or blank for a minute | Render is waking up. Talk through the architecture while it loads, then refresh. |
| Drafts look plain or one-line | Gemini quota is used up or the key is missing, and the rule engine is answering. Say so: this is the designed fallback that keeps the loop running. Settings and Dev, Runtime show it. Switch to a fresh key on Render if you have time. |
| A step says "Not delivered" | Real sending stayed safe. Dev, Real email shows the reason. Skip the real-email segment and use the sandbox instead. |
| Sandbox reply gets a plain answer | Same cause as plain drafts. The booking logic does not depend on the model, so a pick of "the second one" still books. |
| A campaign shows "Held: outside working hours" | Limits run on a simulated clock (a day lasts 72 seconds). Wait a moment, or check the campaign's working hours. Never turn limits off in front of judges without saying so. |
| Anything unrecoverable | Fall back to the sandbox, which needs only the site and works with or without Gemini. |

## What to say about real versus simulated

- **Real:** the control plane, Gemini decisions and drafts, the local embeddings, hard limits, approvals, the grounding check, prompt versioning, the agent success measurements, meeting scheduling with calendar invites, and (when configured) real email through the Gmail API.
- **Simulated by design:** prospects in simulated campaigns (an AI acts as a people-search tool and invents realistic people) and their replies. Real campaigns use only people entered by hand.
- **Not built:** Apollo or LinkedIn data, reading the rep's real calendar, unsubscribe links (today a reply of "unsubscribe" or "stop" works), and delivery tracking beyond the provider's acceptance.
- **DronaHQ:** the control plane and agent contracts were designed for the platform; the webhook adapter is built, but in our testing it returned no agent output, so decisions run on Gemini plus the rule engine. Say this plainly if asked: the team wrote and can explain every line underneath.

## Likely questions

- **How do you keep cost down?** Matching versus judgment: similarity and rules settle what they can without a model, obvious rejections skip the LLM, clear opt-outs are routed by embeddings, there is a daily call cap, and the panel shows tokens and cost per prospect and per qualified lead.
- **How do you stop it sending something wrong?** Grounding check on every draft, approval levels, hard limits, and for real people a human approves every message.
- **What if a campaign is not working?** Analytics flags it with reasons, the brief can be changed as a versioned commit, and success is compared by prompt version.
