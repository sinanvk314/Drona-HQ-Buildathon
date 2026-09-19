// Real Agentic AI mode (PS Section 4): calls Anthropic's Messages API with a forced tool call
// so every agent returns a structured, typed decision instead of free text. Used when
// AGENT_ENGINE=llm and ANTHROPIC_API_KEY is set (see src/config.js and src/services/agentEngine/index.js
// for the fallback to ruleEngine.js when it isn't).
//
// This mirrors exactly how a DronaHQ Agentic AI "thin shell" agent would be called in production
// (see the project's step-by-step-build-plan.md): a generic instruction, campaign-scoped prompt
// + override + retrieved knowledge passed in per call, structured JSON back. Swapping this module
// for a call to a DronaHQ webhook instead of the Anthropic SDK needs no changes to the callers.
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config.js";

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

async function callTool({ model, system, prompt, toolName, description, schema }) {
  const resp = await getClient().messages.create({
    model,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: prompt }],
    tools: [{ name: toolName, description, input_schema: schema }],
    tool_choice: { type: "tool", name: toolName },
  });
  const toolUse = resp.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("Agent did not return a structured response.");
  return toolUse.input;
}

function knowledgeBlock(knowledge) {
  if (!knowledge?.length) return "(no knowledge retrieved)";
  return knowledge.map((k) => `[${k.label}]\n${k.text}`).join("\n\n");
}

const SHELL_PREAMBLE =
  "Follow the instructions in PROMPT exactly. Use only the facts in CONTEXT and KNOWLEDGE — never fabricate a detail " +
  "that is not present in them. Respond only by calling the provided tool.";

export async function llmScoreICP({ campaign, prospect, promptText, knowledge }) {
  const prompt =
    `${SHELL_PREAMBLE}\n\nPROMPT:\n${promptText}\n\nCONTEXT:\n${JSON.stringify(
      { icp: campaign.icpText, companyCriteria: campaign.companyCriteria, exclusionCriteria: campaign.exclusionCriteria, prospect },
      null,
      2
    )}\n\nKNOWLEDGE:\n${knowledgeBlock(knowledge)}`;
  return callTool({
    model: config.modelFast,
    system: "You are the ICP Fitment agent for an autonomous SDR system.",
    prompt,
    toolName: "submit_icp_decision",
    description: "Submit the qualification decision for this prospect.",
    schema: {
      type: "object",
      required: ["qualified", "score", "reasoning", "reasons", "evidence"],
      properties: {
        qualified: { type: "boolean" },
        score: { type: "integer", minimum: 0, maximum: 100 },
        reasoning: { type: "string" },
        reasons: { type: "array", items: { type: "string" } },
        evidence: { type: "array", items: { type: "string" } },
      },
    },
  });
}

export async function llmDraftOutreach({ campaign, prospect, promptText, override, knowledge }) {
  const prompt =
    `${SHELL_PREAMBLE}\n\nPROMPT:\n${promptText}\n${override ? `\nCAMPAIGN OVERRIDE:\n${override}\n` : ""}\n` +
    `CONTEXT:\n${JSON.stringify({ channels: campaign.channels, prospect }, null, 2)}\n\nKNOWLEDGE:\n${knowledgeBlock(knowledge)}`;
  return callTool({
    model: config.modelSmart,
    system: "You are the Personalisation & Outreach Strategy agent for an autonomous SDR system.",
    prompt,
    toolName: "submit_outreach_draft",
    description: "Submit the chosen channel and drafted opening message.",
    schema: {
      type: "object",
      required: ["channel", "subject", "body", "reasoning"],
      properties: {
        channel: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        reasoning: { type: "string" },
      },
    },
  });
}

export async function llmHandleConversation({ campaign, prospect, promptText, override, knowledge }) {
  const prompt =
    `${SHELL_PREAMBLE}\n\nPROMPT:\n${promptText}\n${override ? `\nCAMPAIGN OVERRIDE:\n${override}\n` : ""}\n` +
    `CONTEXT:\n${JSON.stringify({ approvals: campaign.approvals, conversation: prospect.conversation }, null, 2)}\n\nKNOWLEDGE:\n${knowledgeBlock(
      knowledge
    )}`;
  return callTool({
    model: config.modelSmart,
    system: "You are the Conversation & Follow-up agent for an autonomous SDR system.",
    prompt,
    toolName: "submit_conversation_decision",
    description: "Decide the next action for this prospect's conversation.",
    schema: {
      type: "object",
      required: ["action", "reasoning"],
      properties: {
        action: { type: "string", enum: ["meeting", "escalate", "followup"] },
        reasoning: { type: "string" },
      },
    },
  });
}
