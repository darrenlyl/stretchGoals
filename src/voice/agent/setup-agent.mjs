// Sends Maizy's config (maizy-config.mjs) to ElevenLabs.
// First run: creates the agent and prints its ID. Put that ID in .env as ELEVENLABS_AGENT_ID.
// Later runs: updates the same agent, so edit maizy-config.mjs and run this again.
//
// Run from the repo root:  node --env-file=.env src/voice/agent/setup-agent.mjs
import {
  AGENT_NAME,
  FIRST_MESSAGE,
  PROMPT,
  VOICE,
  TURN_TIMEOUT_SECONDS,
  MAX_DURATION_SECONDS,
  SILENCE_END_CALL_SECONDS,
  TOOLS,
} from "./maizy-config.mjs";

const API = "https://api.elevenlabs.io/v1/convai";
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY || !VOICE.voice_id) throw new Error("Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID in .env.");

// A small helper: call the ElevenLabs API and stop with a clear message if it fails.
async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}

// 1. Tools live on their own in ElevenLabs. Create each one, or update it if one with that name exists.
const existing = (await call("GET", "/tools")).tools ?? [];
const toolIds = [];
for (const tool of TOOLS) {
  const match = existing.find((t) => t.tool_config?.name === tool.name);
  if (match) {
    await call("PATCH", `/tools/${match.id}`, { tool_config: tool });
    toolIds.push(match.id);
    console.log(`updated tool ${tool.name}`);
  } else {
    const created = await call("POST", "/tools", { tool_config: tool });
    toolIds.push(created.id);
    console.log(`created tool ${tool.name}`);
  }
}

// 2. The agent itself: prompt, first line, voice, timing, and which tools it may use.
const agent = {
  name: AGENT_NAME,
  conversation_config: {
    agent: {
      first_message: FIRST_MESSAGE,
      language: "en",
      prompt: {
        prompt: PROMPT,
        tool_ids: toolIds,
        built_in_tools: { end_call: { name: "end_call", description: "", params: { system_tool_type: "end_call" } } },
      },
    },
    tts: VOICE,
    turn: { turn_timeout: TURN_TIMEOUT_SECONDS, silence_end_call_timeout: SILENCE_END_CALL_SECONDS },
    conversation: { max_duration_seconds: MAX_DURATION_SECONDS },
  },
};

const agentId = process.env.ELEVENLABS_AGENT_ID;
if (agentId) {
  await call("PATCH", `/agents/${agentId}`, agent);
  console.log(`\nUpdated Maizy (${agentId}).`);
} else {
  const created = await call("POST", "/agents/create", agent);
  console.log(`\nCreated Maizy! Put this line in .env:\n\nELEVENLABS_AGENT_ID=${created.agent_id}\n`);
}
