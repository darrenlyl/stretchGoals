// Demo: what Ossie says when you slouch and keep slouching.
// It follows the voice coach rules from TEAM_GUIDE.md (Track 3, milestone 4):
//   - only speak about SUSTAINED issues (lasting ~5 s)
//   - wait 3 minutes before repeating the same issue, 60 s between any two lines
//   - say a praise line when the issue goes away
//
// Run from the repo root:  node --env-file=.env src/voice/demo-slouch.mjs
// Files land in voice-tuning/demo/ (git-ignored), numbered in the order Ossie says them.
import { mkdir, writeFile } from "node:fs/promises";

const MODEL_ID = "eleven_v4_turbo";
const SPEED = 0.9;

// What happens, minute by minute. "when" is time since you started slouching.
const TIMELINE = [
  {
    when: "0:05",
    what: "slouching becomes sustained, first nudge",
    text: "Heads up… you're hunching over a little. Roll your shoulders back, and sit up tall.",
  },
  {
    when: "3:05",
    what: "still slouching after the 3-minute cooldown, offer a stretch",
    text: "Still a bit hunched, I'm afraid. Shall we do a quick stretch? A seated chest opener only takes twenty seconds.",
  },
  {
    when: "3:15",
    what: "you say yes, stretch intro with the safety line",
    text: "Lovely. Move gently, and stop if anything hurts. This isn't medical advice.",
  },
  {
    when: "3:20",
    what: "stretch step",
    text: "Clasp your hands behind your back… squeeze your shoulder blades together… and lift your chest. Hold it there.",
  },
  {
    when: "3:35",
    what: "countdown",
    text: "Five… four… three… two… one.",
  },
  {
    when: "3:40",
    what: "posture recovers, praise",
    text: "Nice work! You're sitting tall again, and your score is back up. I'll be right here if you need me.",
  },
];

if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID) {
  throw new Error("Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID in .env.");
}

await mkdir("voice-tuning/demo", { recursive: true });

for (const [i, step] of TIMELINE.entries()) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: step.text,
      model_id: MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: SPEED },
    }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);

  const file = `voice-tuning/demo/${i + 1}.mp3`;
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`${step.when}  ${step.what}\n       "${step.text}"\n       -> ${file}\n`);
}
