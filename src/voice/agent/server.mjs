// A tiny local server for the Maizy test page. It does two jobs:
//   1. Serves the files in src/ so the browser can load agent-dev.html.
//   2. Hands the page a short-lived "signed URL" for talking to Maizy, so the API key never reaches the browser.
// In the real app, Shawn's Electron main process does job 2 instead.
//
// Run from the repo root:  node --env-file=.env src/voice/agent/server.mjs
// Then open:               http://localhost:8787
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const PORT = 8787;
const SRC = join(process.cwd(), "src");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };

if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_AGENT_ID) {
  throw new Error("Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID in .env. Run setup-agent.mjs first.");
}

// Ask ElevenLabs for a signed URL. It works for about 15 minutes and only for this one agent.
async function signedUrl() {
  const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${process.env.ELEVENLABS_AGENT_ID}`;
  const res = await fetch(url, { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });
  if (!res.ok) throw new Error(`ElevenLabs said ${res.status}: ${await res.text()}`);
  return (await res.json()).signed_url;
}

createServer(async (req, res) => {
  try {
    const path = new URL(req.url, `http://localhost:${PORT}`).pathname;

    if (path === "/signed-url") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ signedUrl: await signedUrl() }));
      return;
    }

    // "/" sends you to the test page's real address, so its relative imports (./agent-dev.js) work.
    if (path === "/") {
      res.writeHead(302, { Location: "/voice/agent/agent-dev.html" }).end();
      return;
    }

    // Serve a file from src/ only. Anything outside src/ (like .env) is refused.
    const file = normalize(join(SRC, path));
    if (!file.startsWith(SRC + sep)) {
      res.writeHead(403).end("Not allowed");
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === "ENOENT" ? 404 : 500).end(String(err.message ?? err));
  }
}).listen(PORT, () => console.log(`Maizy test page: http://localhost:${PORT}`));
