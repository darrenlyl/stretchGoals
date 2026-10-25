// Sends the stretchGoals safety graph to IndyKite (Capture API). Safe to re-run: it updates, it doesn't duplicate.
//
//   (Person)-[:HAS_CONDITION]->(Condition)-[:BLOCKS | :ASK_FIRST | :CAUTION]->(Stretch)
//   (Person)-[:CLEARED_CONDITION]->(Condition)  same condition, but a clinician said it's okay.
//                                               Used INSTEAD of HAS_CONDITION, so ASK_FIRST stops applying.
//
// Run from the repo root:  node indykite/push.mjs --dry-run   (shows what it would send)
//                          node indykite/push.mjs             (sends it)
import { STRETCHES } from "../src/stretches/index.js";
import { CONDITIONS, DEMO_PEOPLE } from "./rules.js";
import { post } from "./ik.mjs";

const dryRun = process.argv.includes("--dry-run");
const prop = (type, value) => ({ type, value });
const ref = (type, id) => ({ type, external_id: id });

// 1. Nodes (the dots)
const nodes = [
  ...STRETCHES.map((s) => ({
    type: "Stretch",
    external_id: s.id,
    properties: [prop("name", s.name), prop("source_url", s.source.url)],
  })),
  ...CONDITIONS.map((c) => ({
    type: "Condition",
    external_id: c.id,
    properties: [prop("label", c.label), prop("level", c.level), prop("note", c.note), prop("source_url", c.source.url)],
  })),
  ...DEMO_PEOPLE.map((p) => ({
    type: "Person",
    external_id: p.id,
    is_identity: true,
    properties: [prop("name", p.name)],
  })),
];

// 2. Relationships (the arrows)
const EDGE = { block: "BLOCKS", ask_first: "ASK_FIRST", caution: "CAUTION" };
const relationships = [
  ...CONDITIONS.flatMap((c) =>
    c.stretches.map((s) => ({ source: ref("Condition", c.id), target: ref("Stretch", s), type: EDGE[c.level] })),
  ),
  ...DEMO_PEOPLE.flatMap((p) =>
    p.conditions.map((c) => ({
      source: ref("Person", p.id),
      target: ref("Condition", c),
      type: p.cleared.includes(c) ? "CLEARED_CONDITION" : "HAS_CONDITION",
    })),
  ),
];

console.log(`${nodes.length} nodes, ${relationships.length} relationships`);
const count = (list, key) => list.reduce((n, x) => ((n[x[key]] = (n[x[key]] ?? 0) + 1), n), {});
console.log("nodes:", count(nodes, "type"));
console.log("relationships:", count(relationships, "type"));

if (dryRun) {
  console.log("\nDry run: nothing sent. Example relationship:", JSON.stringify(relationships[0]));
  process.exit(0);
}

// Nodes first, because relationships need both ends to exist. (Capture takes up to 250 per request.)
for (const [path, key, items] of [
  ["/capture/v1/nodes", "nodes", nodes],
  ["/capture/v1/relationships", "relationships", relationships],
]) {
  for (let i = 0; i < items.length; i += 250) {
    const r = await post(path, { [key]: items.slice(i, i + 250) });
    console.log(`POST ${path} -> ${r.status}${r.ok ? "" : ` ${r.text}`}`);
    if (!r.ok) process.exit(1);
  }
}
console.log("Done: graph pushed to IndyKite.");
