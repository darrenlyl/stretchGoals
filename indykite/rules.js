// Which health conditions affect which stretches, and how. Every rule has a source.
// push.mjs turns this into the IndyKite graph; the policy (policy.json) then enforces it.
//
// Levels:
//   "block"      the stretch is never offered            -> (Condition)-[:BLOCKS]->(Stretch)
//   "ask_first"  only once a clinician has cleared them  -> (Condition)-[:ASK_FIRST]->(Stretch)
//   "caution"    offered, with a note Maizy says          -> (Condition)-[:CAUTION]->(Stretch)
//
// Researched 24 Oct 2026. Only conditions with a reputable source are here.

const ALL = ["chin_tuck", "upper_trap", "levator", "chest_opener", "scap_squeeze", "shoulder_rolls", "seated_extension", "eye_break"];
const NECK = ["chin_tuck", "upper_trap", "levator"];
const ARMS = ["chest_opener", "scap_squeeze", "shoulder_rolls", "seated_extension"];

export const CONDITIONS = [
  {
    id: "recent_neck_shoulder_surgery",
    label: "Neck or shoulder surgery (recent)",
    level: "block",
    stretches: ALL,
    note: "Please only do the exercises your surgical team or physio gave you.",
    source: {
      name: "Worcestershire Acute Hospitals NHS Trust: exercises after neck surgery",
      url: "https://www.worcsacute.nhs.uk/leaflets/advice-and-exercises-following-neck-dissection-major-head-and-neck-surgery/",
    },
  },
  {
    id: "recent_shoulder_dislocation",
    label: "Shoulder dislocation (recent)",
    level: "block",
    stretches: ARMS,
    note: "Keep your elbow below shoulder height and follow your physio's exercises.",
    source: {
      name: "Oxford University Hospitals NHS: shoulder dislocation advice",
      url: "https://www.ouh.nhs.uk/media/ph4dp0pf/116941shoulder-dislocation.pdf",
    },
  },
  {
    id: "spinal_fracture",
    label: "Spinal fracture or many broken bones",
    level: "ask_first",
    stretches: ALL,
    note: "Check with your doctor or physio before starting new exercises.",
    source: {
      name: "Royal Osteoporosis Society: how to exercise safely for bones",
      url: "https://theros.org.uk/information-and-support/exercise/how-to-exercise-safely-for-bones/",
    },
  },
  {
    id: "shoulder_pain",
    label: "Rotator cuff, impingement or frozen shoulder",
    level: "caution",
    stretches: ["chest_opener", "seated_extension"],
    note: "Stop if your shoulder hurts. These should not be painful.",
    source: {
      name: "NHS Borders: shoulder impingement, rotator cuff injury and inflammation",
      url: "https://rightdecisions.scot.nhs.uk/patient-information-leaflets/primary-community-services/physiotherapy/shoulder-impingement-rotator-cuff-injury-and-inflammation",
    },
  },
  {
    id: "whiplash",
    label: "Neck injury or whiplash",
    level: "caution",
    stretches: NECK,
    note: "Keep your neck moving gently. If pain gets worse, do smaller movements.",
    source: {
      name: "NHS Fife: whiplash neck pain",
      url: "https://www.nhsfife.org/media/33112/whiplash_neck_pain_v7.pdf",
    },
  },
  {
    id: "pinched_nerve",
    label: "Neck disc or pinched nerve",
    level: "caution",
    stretches: NECK,
    note: "Gentle movement helps. Get urgent help if arm weakness or numbness gets worse.",
    source: {
      name: "Wrightington, Wigan & Leigh NHS: cervical radiculopathy",
      url: "https://www.wwl.nhs.uk/pdfreader/cnv-wwl-68ca8bce6fdfd0.09524493",
    },
  },
  {
    id: "hypermobility",
    label: "Hypermobile joints",
    level: "caution",
    stretches: ALL,
    note: "Go gently, and don't push your joints to the end of their range.",
    source: {
      name: "Leeds Community Healthcare NHS: hypermobility",
      url: "https://leedscommunityhealthcare.nhs.uk/?p=17524",
    },
  },
  {
    id: "dizziness",
    label: "Dizziness when moving your head",
    level: "caution",
    stretches: NECK,
    note: "Stop if you feel dizzy, and speak to a health professional if it keeps happening.",
    source: {
      name: "NHS Lanarkshire: dizziness with neck pain",
      url: "https://www.nhslanarkshire.scot.nhs.uk/?p=16282",
    },
  },
  {
    id: "wrist_pain",
    label: "Carpal tunnel or wrist pain",
    level: "caution",
    stretches: ["chest_opener"],
    note: "Keep your wrists straight when you clasp your hands.",
    source: {
      name: "University Hospitals Plymouth NHS: carpal tunnel syndrome",
      url: "https://www.plymouthhospitals.nhs.uk/display-pil/pil-carpal-tunnel-syndrome-cts-6902",
    },
  },
];

// Anonymous demo people for testing the policy. In the app, each user would be one Person.
export const DEMO_PEOPLE = [
  { id: "sg-demo-none", name: "Demo: no conditions", conditions: [], cleared: [] },
  { id: "sg-demo-dislocation", name: "Demo: recent shoulder dislocation", conditions: ["recent_shoulder_dislocation"], cleared: [] },
  { id: "sg-demo-surgery", name: "Demo: recent neck surgery", conditions: ["recent_neck_shoulder_surgery"], cleared: [] },
  { id: "sg-demo-spinal", name: "Demo: spinal fracture, not cleared", conditions: ["spinal_fracture"], cleared: [] },
  { id: "sg-demo-spinal-cleared", name: "Demo: spinal fracture, cleared", conditions: ["spinal_fracture"], cleared: ["spinal_fracture"] },
  { id: "sg-demo-caution", name: "Demo: hypermobile + dizzy", conditions: ["hypermobility", "dizziness"], cleared: [] },
];

/** What the policy SHOULD answer for a person: the stretch IDs they may receive. Used by check.mjs. */
export function allowedStretches(person) {
  const mine = CONDITIONS.filter((c) => person.conditions.includes(c.id));
  return ALL.filter((stretchId) =>
    mine.every((c) => {
      if (!c.stretches.includes(stretchId)) return true;
      if (c.level === "block") return false;
      if (c.level === "ask_first") return person.cleared.includes(c.id);
      return true; // caution doesn't block
    }),
  );
}
