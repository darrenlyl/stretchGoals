// Asks IndyKite "which stretches may this person RECEIVE?" for every demo person,
// and checks the answer against our own rules (rules.js). Prints PASS or FAIL per person.
//
// Run from the repo root:  node indykite/check.mjs
import { DEMO_PEOPLE, allowedStretches } from "./rules.js";
import { post } from "./ik.mjs";

let failed = 0;

for (const person of DEMO_PEOPLE) {
  // AuthZEN "search resources": every Stretch this subject may RECEIVE, according to the active policy
  const r = await post("/access/v1/search/resource", {
    subject: { type: "Person", id: person.id },
    action: { name: "RECEIVE" },
    resource: { type: "Stretch" },
  });
  if (!r.ok) {
    failed++;
    console.log(`FAIL  ${person.name}: HTTP ${r.status} ${r.text}`);
    continue;
  }

  const got = (r.body?.results ?? []).map((x) => x.id).sort();
  const expected = allowedStretches(person).sort();
  const pass = got.join() === expected.join();
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${person.name}: ${got.length} allowed${pass ? "" : ` (expected ${expected.length}: ${expected.join(", ") || "none"}; got: ${got.join(", ") || "none"})`}`);
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed: IndyKite enforces the sourced rules.");
process.exit(failed ? 1 : 0);
