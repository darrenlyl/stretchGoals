// Shared helper for the IndyKite scripts: reads the app agent token and POSTs JSON.
// The token is read from .secrets/app-agent-credential.json, only sent to IndyKite, and never printed.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const BASE = "https://us.api.indykite.com"; // the sandbox project is in the US region

function readToken() {
  const file = join(process.cwd(), ".secrets", "app-agent-credential.json");
  let text;
  try {
    text = readFileSync(file, "utf8").trim();
  } catch {
    throw new Error("No app agent token. Save it as .secrets/app-agent-credential.json (see the Hub).");
  }
  // The Hub gives either the raw token or a JSON file with a "token" field
  try {
    return JSON.parse(text).token.trim();
  } catch {
    return text;
  }
}

/** POST JSON to IndyKite. Returns { ok, status, body }. Never throws, never shows the token. */
export async function post(path, body) {
  const token = readToken();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-IK-ClientKey": token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = (await res.text()).split(token).join("[redacted]");
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { ok: res.ok, status: res.status, body: json, text: text.slice(0, 400) };
  } catch (err) {
    return { ok: false, status: 0, text: String(err.message ?? err).split(token).join("[redacted]") };
  }
}
