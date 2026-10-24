// Tune a voice by ear: make the same line with different settings, then listen and compare.
// Change ONE setting at a time, so you know which one made the difference.
//
// Run from the repo root, one round at a time:
//   node --env-file=.env src/voice/tune-voice.mjs model       (which model sounds most like her?)
//   node --env-file=.env src/voice/tune-voice.mjs speed       (how fast should she talk?)
//   node --env-file=.env src/voice/tune-voice.mjs stability   (how calm vs expressive?)
//
// Files land in voice-tuning/ (git-ignored). Play one with:  afplay voice-tuning/<file>.mp3
// When you find a winner, copy its settings into BEST below and run the next round.
import { mkdir, writeFile } from "node:fs/promises";

const TEXT =
  "Heads up… your neck's drifting a little forward. Let's try a chin tuck together. Sit tall, and slowly slide your chin back.";

// The best settings so far. Each round changes one of these and keeps the rest.
const BEST = { model: "eleven_v4_turbo", speed: 0.9, stability: 0.5, similarity: 0.75 };

const ROUNDS = {
  model: [
    { model: "eleven_flash_v2_5" },
    { model: "eleven_multilingual_v2" },
    { model: "eleven_v3" },
    { model: "eleven_v4" },
    { model: "eleven_v4_turbo" }, // live
    { model: "eleven_v3_conversational" }, // live
  ],
  speed: [{ speed: 0.8 }, { speed: 0.9 }, { speed: 1.0 }],
  stability: [{ stability: 0.3 }, { stability: 0.5 }, { stability: 0.7 }],
};

const round = process.argv[2];
if (!ROUNDS[round]) {
  throw new Error(`Pick a round: ${Object.keys(ROUNDS).join(", ")}`);
}
// Optional: tune a different model than BEST, e.g.  ... tune-voice.mjs speed eleven_flash_v2_5
if (process.argv[3]) BEST.model = process.argv[3];
if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID) {
  throw new Error("Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID in .env.");
}

await mkdir("voice-tuning", { recursive: true });

for (const change of ROUNDS[round]) {
  const s = { ...BEST, ...change };
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: TEXT,
      model_id: s.model,
      voice_settings: { stability: s.stability, similarity_boost: s.similarity, speed: s.speed },
    }),
  });
  const name = `${round}-${s.model}-speed${s.speed}-stab${s.stability}.mp3`;
  if (!res.ok) {
    console.log(`skip ${name}: ${res.status} ${(await res.text()).slice(0, 120)}`);
    continue;
  }
  await writeFile(`voice-tuning/${name}`, Buffer.from(await res.arrayBuffer()));
  console.log(`made voice-tuning/${name}`);
}
