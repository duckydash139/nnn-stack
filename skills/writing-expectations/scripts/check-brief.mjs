#!/usr/bin/env node
// Checks that a brief or a roadmap follows the writing-expectations format.
// With --repo, also checks that a brief fits the repository. With --draft, a brief may still have open questions.
//   node check-brief.mjs <brief.md | roadmap.md> [--repo <repository root>] [--draft]
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SECTIONS = ["Glossary", "New", "Changes", "Journeys", "Not expectations", "Open questions"];
const CRITICALITY = ["critical", "important", "other"];
const JOURNEY_FIELDS = ["Flow", "Criticality", "Persona", "Context", "Intent"];
const HUMAN_ID = /^[A-Z]{2,6}-\d+$/;
const MAX_FEATURES = 3;
const MAX_LINES = 25;
const ROADMAP_SECTIONS = ["Actors", "Milestones", "Later"];
const STATUSES = ["done", "current", "planned"];
const FEATURE_HEADING = /^### ([a-z0-9]+(?:-[a-z0-9]+)*) \(([A-Z]{2,6})\)$/;
const VAGUE = /\b(fast|faster|quick|quickly|slow|user[- ]friendly|intuitive|relevant|secure|securely|easy|easily|simple|appropriate|appropriately|properly|reasonable|efficient|efficiently|seamless|seamlessly|robust|optimal|as needed|etc)\b/i;
const DESIGN = /\b(database|db|sql|column|cache|caching|redis|postgres|postgresql|mysql|mongodb|sqlite|react|vue|svelte|kafka|microservices?|lambda|s3|graphql|websockets?|orm)\b/i;

const args = process.argv.slice(2);
const repoIndex = args.indexOf("--repo");
const repo = repoIndex === -1 ? undefined : args[repoIndex + 1];
const draft = args.includes("--draft");
const file = args.find((a, i) => !a.startsWith("--") && (repoIndex === -1 || i !== repoIndex + 1));
if (!file) exit(["Usage: node check-brief.mjs <brief.md | roadmap.md> [--repo <repository root>] [--draft]"]);
if (!existsSync(file)) exit([`${file} does not exist.`]);
if (repo !== undefined && !existsSync(repo)) exit([`--repo ${repo} does not exist.`]);

const errors = [];
const lines = readFileSync(file, "utf8").split(/\r?\n/);

function exit(messages) {
  for (const message of messages) console.error(message);
  process.exit(1);
}

function isValidEars(text) {
  if (!/\bSHALL\b/.test(text)) return false;
  if (!/^(WHEN|WHILE|IF|WHERE|THE)\b/.test(text)) return false;
  if (/^IF\b/.test(text) && !/\bTHEN\b/.test(text)) return false;
  return true;
}

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function checkLine(at, text) {
  if (!isValidEars(text)) {
    errors.push(`${at} Not an EARS line. Start with WHEN, WHILE, IF ... THEN, WHERE, or THE, and include SHALL.`);
    return;
  }
  const plain = text.replace(/`[^`]*`/g, "");
  if ((plain.match(/\bSHALL\b/g) ?? []).length > 1) {
    errors.push(`${at} Two SHALLs in one line. Split it into one line per behavior.`);
  }
  const vague = VAGUE.exec(plain);
  if (vague) {
    errors.push(`${at} "${vague[0]}" can't be tested. Replace it with a number or a rule the human approves. If it is a name, wrap it in backticks.`);
  }
  const design = DESIGN.exec(plain);
  if (design) {
    errors.push(`${at} "${design[0]}" is a design choice. Write the behavior it guarantees, and move the choice to Not expectations. If it is a name, wrap it in backticks.`);
  }
}

// Journey test files under dir, skipping dependencies and build output.
function journeyFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return journeyFiles(path);
    return /\.journey\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

// Human expectations in the repository: id -> { text, feature }, feature -> prefix, and retired IDs.
// They live in expectation files, or as journey test titles that start with the ID, per the verification skill.
// For journeys, journeys/spec.json lists which feature owns each prefix and which IDs are retired.
function readRepo(root) {
  const byId = new Map();
  const prefixes = new Map();
  const retired = new Set();
  const unlisted = new Set();
  const spec = join(root, "journeys", "spec.json");
  const config = existsSync(spec) ? JSON.parse(readFileSync(spec, "utf8")) : {};
  for (const id of config.retiredIds ?? []) retired.add(id);
  const owner = new Map();
  for (const [feature, prefix] of Object.entries(config.prefixes ?? {})) {
    prefixes.set(feature, prefix);
    owner.set(prefix, feature);
  }
  const title = /(["'`])([A-Z]{2,6})-(\d+): ((?:WHEN|WHILE|IF|WHERE|THE)\b.*?)\1/g;
  for (const path of journeyFiles(join(root, "journeys"))) {
    for (const m of readFileSync(path, "utf8").matchAll(title)) {
      byId.set(`${m[2]}-${m[3]}`, { text: m[4], feature: owner.get(m[2]), journey: true });
      if (!owner.has(m[2])) unlisted.add(m[2]);
    }
  }
  const featuresDir = join(root, "features");
  if (!existsSync(featuresDir)) return { byId, prefixes, retired, unlisted };
  for (const entry of readdirSync(featuresDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(featuresDir, entry.name, `${entry.name}.expectations.md`);
    if (!existsSync(path)) continue;
    let section = "";
    for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
      const heading = /^##\s+(.+?)\s*$/.exec(raw);
      if (heading) section = heading[1];
      const m = /^- ([A-Z]{2,6})-(\d+): (.+)$/.exec(raw);
      if (!m) continue;
      prefixes.set(entry.name, m[1]);
      if (section === "Human") byId.set(`${m[1]}-${m[2]}`, { text: m[3], feature: entry.name });
    }
  }
  return { byId, prefixes, retired, unlisted };
}

// Journey titles with IDs at a past commit, read through git, so a brief reconciled with an older
// commit is checked against lines that changed since.
function titlesAt(root, commit) {
  const git = (...args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const tree = git("ls-tree", "-r", "--name-only", commit, "--", "journeys");
  if (tree.status !== 0) return undefined;
  const titles = new Map();
  const title = /(["'`])([A-Z]{2,6})-(\d+): ((?:WHEN|WHILE|IF|WHERE|THE)\b.*?)\1/g;
  for (const path of tree.stdout.split("\n").filter((each) => /\.journey\.test\.ts$/.test(each))) {
    const shown = git("show", `${commit}:${path}`);
    if (shown.status !== 0) return undefined;
    for (const m of shown.stdout.matchAll(title)) titles.set(`${m[2]}-${m[3]}`, m[4]);
  }
  return titles;
}

function checkRoadmap() {
  let section;
  let milestone;
  const milestones = [];
  const seenSections = new Set();
  lines.slice(1).forEach((raw, index) => {
    const at = `${file}:${index + 2}`;
    const text = raw.trimEnd();
    if (text.trim() === "") return;
    const heading = /^## (.+?)\s*$/.exec(text);
    if (heading) {
      section = heading[1];
      milestone = undefined;
      if (!ROADMAP_SECTIONS.includes(section)) errors.push(`${at} Unknown section "${section}". Use only: ${ROADMAP_SECTIONS.join(", ")}.`);
      seenSections.add(section);
      return;
    }
    if (section === "Actors") {
      if (!/^- [^:]+: \S/.test(text)) errors.push(`${at} Write actors as "- Actor: what they use the product for, and through which app."`);
    } else if (section === "Milestones") {
      const m = /^### M(\d+): \S.*$/.exec(text);
      if (m) {
        milestone = { at, number: Number(m[1]), status: undefined, outcome: false, goals: 0 };
        milestones.push(milestone);
      } else if (!milestone) {
        errors.push(`${at} Start each milestone with "### M<n>: <name>".`);
      } else if (/^Status: /.test(text)) {
        milestone.status = text.slice("Status: ".length).trim();
        if (!STATUSES.includes(milestone.status)) errors.push(`${at} Status must be one of: ${STATUSES.join(", ")}.`);
      } else if (/^Outcome: \S/.test(text)) {
        milestone.outcome = true;
      } else if (text.startsWith("- ")) {
        milestone.goals += 1;
        if (/\bSHALL\b/.test(text)) errors.push(`${at} Goals are plain sentences. EARS lines go in the milestone's brief.`);
      } else {
        errors.push(`${at} Under a milestone, write only "Status:", "Outcome:", and "- " goal lines.`);
      }
    } else if (section === "Later") {
      if (!text.startsWith("- ")) errors.push(`${at} Write each later goal as a "- " item.`);
    } else {
      errors.push(`${at} Put this under a section.`);
    }
  });
  for (const required of ["Actors", "Milestones"]) {
    if (!seenSections.has(required)) errors.push(`${file}: Missing section "## ${required}".`);
  }
  milestones.forEach((m, index) => {
    if (m.number !== index + 1) errors.push(`${m.at} Number milestones M1, M2, M3 in order.`);
    if (!m.status) errors.push(`${m.at} Add a "Status: planned", "Status: current", or "Status: done" line.`);
    if (!m.outcome) errors.push(`${m.at} Add an "Outcome: <what the human can check when it's done>" line.`);
    if (m.goals === 0) errors.push(`${m.at} Add at least one "- " goal line.`);
  });
  const order = milestones.map((m) => STATUSES.indexOf(m.status ?? "planned"));
  if (order.some((rank, index) => index > 0 && rank < order[index - 1])) {
    errors.push(`${file}: Milestones go done, then current, then planned, in that order.`);
  }
  const currents = milestones.filter((m) => m.status === "current").length;
  if (currents > 1) errors.push(`${file}: Only one milestone can be current.`);
  if (milestones.length > 0 && currents === 0 && milestones.some((m) => m.status === "planned")) {
    errors.push(`${file}: Mark the first planned milestone as current.`);
  }
  if (errors.length > 0) exit(errors);
  console.log(`check-brief ok. Roadmap with ${milestones.length} milestone${milestones.length === 1 ? "" : "s"}.`);
  process.exit(0);
}

if (/^# Roadmap: \S/.test(lines[0] ?? "")) checkRoadmap();

// Split into sections.
if (!/^# Brief: \S/.test(lines[0] ?? "")) {
  errors.push(`${file}:1 The first line must be "# Brief: <title>" (or "# Roadmap: <product>" for a roadmap).`);
}
if (!lines.some((l) => /^Milestone: (M\d+|none)$/.test(l))) {
  errors.push(`${file}: Add "Milestone: <M1, M2, ...>" after the title, or "Milestone: none" when there is no roadmap.`);
}
const reconciled = lines.findIndex((l) => l.startsWith("Reconciled with:"));
const reconciledWith = reconciled === -1 ? undefined : lines[reconciled].slice("Reconciled with:".length).trim();
if (reconciled === -1 || !/^(none|[0-9a-f]{7,40})$/.test(reconciledWith ?? "")) {
  errors.push(`${file}: Add "Reconciled with: <commit>" after the title, or "Reconciled with: none" for a new product.`);
}

const bodies = new Map();
let current;
lines.forEach((raw, index) => {
  const heading = /^## (.+?)\s*$/.exec(raw);
  if (heading) {
    current = heading[1];
    if (!SECTIONS.includes(current)) errors.push(`${file}:${index + 1} Unknown section "${current}". Use only: ${SECTIONS.join(", ")}.`);
    if (bodies.has(current)) errors.push(`${file}:${index + 1} Section "${current}" appears twice.`);
    bodies.set(current, []);
    return;
  }
  if (current && raw.trim() !== "") bodies.get(current).push({ at: `${file}:${index + 1}`, text: raw.trimEnd() });
});

const order = [...bodies.keys()].filter((s) => SECTIONS.includes(s));
for (const section of SECTIONS) {
  if (!bodies.has(section)) errors.push(`${file}: Missing section "## ${section}". Write "None." under it if it is empty.`);
}
if (order.join("|") !== SECTIONS.filter((s) => bodies.has(s)).join("|")) {
  errors.push(`${file}: Put the sections in this order: ${SECTIONS.join(", ")}.`);
}

function items(section) {
  const body = bodies.get(section) ?? [];
  if (body.length === 1 && body[0].text === "None.") return [];
  if (body.length === 0 && bodies.has(section)) errors.push(`${file}: Section "${section}" is empty. Write "None." under it.`);
  return body;
}

const { byId, prefixes, retired, unlisted } = repo === undefined ? { byId: new Map(), prefixes: new Map(), retired: new Set(), unlisted: new Set() } : readRepo(repo);
if (unlisted.size > 0) {
  exit([`${repo}: journey titles use the prefixes ${[...unlisted].sort().join(", ")}, which aren't in prefixes in journeys/spec.json, so this brief can't be checked against their features. Ask the builder to migrate the repository first, then run this again.`]);
}
if (repo !== undefined && byId.size > 0 && reconciledWith === "none") {
  errors.push(`${file}: The repository has expectations. Reconcile with them and write the commit after "Reconciled with:".`);
}
if (repo !== undefined && reconciledWith !== undefined && reconciledWith !== "none" && existsSync(join(repo, ".git"))) {
  const then = titlesAt(repo, reconciledWith);
  if (then === undefined) {
    errors.push(`${file}: "Reconciled with: ${reconciledWith}" isn't a commit this repository has.`);
  } else {
    const ids = new Set([...then.keys(), ...[...byId].filter(([, each]) => each.journey).map(([id]) => id)]);
    const moved = [...ids].filter((id) => then.get(id) !== byId.get(id)?.text).sort();
    if (moved.length > 0) {
      errors.push(`${file}: These filed lines changed since ${reconciledWith}: ${moved.join(", ")}. Reconcile the brief with them again and update "Reconciled with:".`);
    }
  }
}
const existingText = new Map([...byId].map(([id, e]) => [normalize(e.text), id]));
const seen = new Map();

function checkNotRepeated(at, text) {
  const key = normalize(text);
  const existing = existingText.get(key);
  if (existing) errors.push(`${at} ${existing} already says this. Drop the line and tell the human it is covered by ${existing}.`);
  const earlier = seen.get(key);
  if (earlier) errors.push(`${at} Same line as ${earlier}. Keep one.`);
  seen.set(key, at);
}

// Glossary.
for (const { at, text } of items("Glossary")) {
  if (!/^- [^:]+: \S/.test(text)) errors.push(`${at} Write glossary entries as "- Term: One-sentence definition."`);
}

// New.
let newCount = 0;
const newFeatures = new Set();
let feature;
const prefixOwner = new Map([...prefixes].map(([f, p]) => [p, f]));
for (const { at, text } of items("New")) {
  if (text.startsWith("### ")) {
    const m = FEATURE_HEADING.exec(text);
    feature = undefined;
    if (!m) {
      errors.push(`${at} Write feature headings as "### <kebab-case-feature> (<PREFIX>)", with a 2 to 6 letter prefix.`);
      continue;
    }
    const [, name, prefix] = m;
    feature = name;
    newFeatures.add(name);
    const known = prefixes.get(name);
    if (known && known !== prefix) errors.push(`${at} Feature ${name} uses the prefix ${known}. Use ${known}.`);
    const owner = prefixOwner.get(prefix);
    if (!known && owner && owner !== name) errors.push(`${at} The prefix ${prefix} belongs to ${owner}. Pick an unused one.`);
    prefixOwner.set(prefix, name);
    continue;
  }
  if (!text.startsWith("- ")) {
    errors.push(`${at} Under New, write only feature headings and "- <EARS line>" items.`);
    continue;
  }
  if (!feature) {
    errors.push(`${at} Put this line under a "### <feature> (<PREFIX>)" heading.`);
    continue;
  }
  const line = text.slice(2);
  if (/^[A-Z]{2,6}-\d+(\.\d+)?:/.test(line)) {
    errors.push(`${at} Remove the ID. The builder assigns IDs to new lines.`);
    continue;
  }
  newCount += 1;
  checkLine(at, line);
  checkNotRepeated(at, line);
}

// Changes.
let replaced = 0;
let withdrawn = 0;
const changed = new Set();
for (const { at, text } of items("Changes")) {
  const m = /^- (Replace|Withdraw) (\S+): (.+)$/.exec(text);
  if (!m) {
    errors.push(`${at} Write changes as "- Replace <ID>: <new EARS line>" or "- Withdraw <ID>: <reason>".`);
    continue;
  }
  const [, kind, id, rest] = m;
  if (!HUMAN_ID.test(id)) errors.push(`${at} ${id} is not a human expectation ID. Only human lines (such as TODO-3) can be replaced or withdrawn.`);
  if (repo === undefined) errors.push(`${at} Changes need the repository. Run again with --repo <repository root>.`);
  else if (retired.has(id)) errors.push(`${at} ${id} is already retired. Check the ID.`);
  else if (!byId.has(id)) errors.push(`${at} ${id} is not a human expectation in the repository. Check the ID.`);
  if (changed.has(id)) errors.push(`${at} ${id} is changed twice. Keep one change per ID.`);
  changed.add(id);
  if (kind === "Replace") {
    replaced += 1;
    checkLine(at, rest);
    if (byId.get(id) && normalize(byId.get(id).text) === normalize(rest)) {
      errors.push(`${at} The new text is the same as ${id}. Drop the change.`);
    } else {
      checkNotRepeated(at, rest);
    }
  } else {
    withdrawn += 1;
  }
}

// Journeys: each one names who acts, where they start, what they want, its steps, and the lines it proves.
let journeyCount = 0;
let journey;
let journeyPart;
const journeys = [];
for (const { at, text } of items("Journeys")) {
  const heading = /^### (.+)$/.exec(text);
  if (heading) {
    journey = { at, title: heading[1], fields: new Map(), steps: 0, lines: 0 };
    journeyPart = undefined;
    journeys.push(journey);
    journeyCount += 1;
    if (/\bSHALL\b/.test(heading[1])) errors.push(`${at} A journey title is a short name a person would say, not an EARS line.`);
    continue;
  }
  if (!journey) {
    errors.push(`${at} Start each journey with "### <short name>".`);
    continue;
  }
  const field = /^([A-Z][a-z]+): (.+)$/.exec(text);
  if (field && JOURNEY_FIELDS.includes(field[1])) {
    journey.fields.set(field[1], field[2].trim());
    if (field[1] === "Flow" && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(field[2].trim())) errors.push(`${at} Write the flow as a kebab-case name, such as dinner-week.`);
    if (field[1] === "Criticality" && !CRITICALITY.includes(field[2].trim())) errors.push(`${at} Criticality must be one of: ${CRITICALITY.join(", ")}.`);
    continue;
  }
  if (text === "Steps:" || text === "Lines:") {
    journeyPart = text.slice(0, -1);
    continue;
  }
  if (journeyPart === "Steps" && /^\d+\. \S/.test(text)) {
    journey.steps += 1;
    if (/\bSHALL\b/.test(text)) errors.push(`${at} A step says what the person does, in plain words. Put the EARS line under Lines.`);
    continue;
  }
  if (journeyPart === "Lines" && text.startsWith("- ")) {
    journey.lines += 1;
    const line = text.slice(2);
    const inBrief = seen.has(normalize(line));
    const inRepo = HUMAN_ID.test(line) ? byId.has(line) : existingText.has(normalize(line));
    if (!inBrief && !inRepo) errors.push(`${at} "${line}" is not a line in this brief or a human expectation in the repository. Use its exact text or its ID.`);
    continue;
  }
  errors.push(`${at} Under a journey, write only ${JOURNEY_FIELDS.map((f) => `"${f}:"`).join(", ")}, then "Steps:" with numbered steps, then "Lines:" with "- " items.`);
}
for (const j of journeys) {
  for (const f of JOURNEY_FIELDS) if (!j.fields.has(f)) errors.push(`${j.at} Add a "${f}: ..." line to this journey.`);
  if (j.steps === 0) errors.push(`${j.at} Add "Steps:" with at least one numbered step.`);
  if (j.lines === 0) errors.push(`${j.at} Add "Lines:" with the lines this journey proves.`);
}

// Not expectations: free text, one item per line.
for (const { at, text } of items("Not expectations")) {
  if (!text.startsWith("- ")) errors.push(`${at} Write each note as a "- " item.`);
  const rule = /^- Every path: (.+)$/.exec(text)?.[1];
  if (rule === undefined) continue;
  const inBrief = seen.has(normalize(rule));
  const inRepo = HUMAN_ID.test(rule) ? byId.has(rule) : existingText.has(normalize(rule));
  if (!inBrief && !inRepo) errors.push(`${at} "${rule}" is not a line in this brief or a human expectation in the repository. Use its exact text or its ID.`);
}

// Open questions.
const open = bodies.get("Open questions") ?? [];
if (!draft && !(open.length === 1 && open[0].text === "None.")) {
  errors.push(`${file}: Open questions must say "None." Ask the human the remaining questions, and write the brief again after the answers.`);
}

if (!draft && newCount + replaced + withdrawn === 0) {
  errors.push(`${file}: The brief has no new lines and no changes.`);
}

// Size: a brief the builder can queue as a few small plans.
const features = new Set(newFeatures);
for (const id of changed) {
  const prefix = id.split("-")[0];
  const feature = byId.get(id)?.feature ?? prefixOwner.get(prefix) ?? prefix;
  if (feature) features.add(feature);
}
const total = newCount + replaced + withdrawn;
if (features.size > MAX_FEATURES || total > MAX_LINES) {
  errors.push(`${file}: The brief has ${total} lines across ${features.size} features. Keep a brief to ${MAX_LINES} lines and ${MAX_FEATURES} features. Split it by feature into brief-<milestone>-1.md, brief-<milestone>-2.md, in dependency order.`);
}

if (errors.length > 0) exit(errors);
console.log(`check-brief ok${draft ? " (draft)" : ""}. New lines: ${newCount}. Features: ${features.size}. Replaced: ${replaced}. Withdrawn: ${withdrawn}. Journeys: ${journeyCount}.`);
