#!/usr/bin/env node
// Generates the journey pages and runs the spec checks. Run it from the project root.
//
//   node tools/journey-spec/journey-spec.mjs generate   write journeys/docs/<flow>.md and journeys/docs/README.md
//   node tools/journey-spec/journey-spec.mjs check      fail on any spec problem or stale page
//   node tools/journey-spec/journey-spec.mjs next-ids   print the next free line ID for each prefix
//   node tools/journey-spec/journey-spec.mjs patches    print each break patch with its owners and proofs
//
// Reads laws.ts, journeys/flows/*.flow.ts, journeys/tests/**/*.journey.test.ts, and every check() from the
// syntax tree. Nothing here imports or runs those files. Needs oxc-parser as a dev dependency.
// An optional journeys/spec.json replaces the vague word list: { "vagueWords": ["quickly"] }, and moves
// the laws file: { "laws": "packages/spec/laws.ts" }, for a workspace whose tests import laws from a package.
// breakWith is optional. When a law, journey, or check names a patch, the patch must exist, and every patch
// in breaks/ must be named.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";

const JOURNEYS = "journeys";
const FLOWS = "journeys/flows";
const PAGES = "journeys/docs";
const TESTS = "journeys/tests";
const BREAKS = "breaks";
const DEFAULT_LAWS = "laws.ts";
const CONFIG = "journeys/spec.json";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "target", "tmp"]);
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const JOURNEY_FILE = /\.journey\.test\.ts$/;
const TEST_NAMES = new Set(["test", "it"]);
// effect, live, scoped, and prop are @effect/vitest's test functions, such as it.effect(title, body).
const TEST_MODIFIERS = new Set(["skip", "only", "fixme", "fail", "fails", "slow", "concurrent", "effect", "live", "scoped", "prop"]);
const REQUIRED_JOURNEY_FIELDS = ["title", "criticality", "level", "flow", "paths", "persona", "context", "intent"];
const CRITICALITY = ["critical", "important", "other"];
const LEVELS = ["api", "dom", "browser"];
// A title may start with the ID of the human-approved line it proves, such as "TODO-7: WHEN ...".
const LINE_ID = /^([A-Z]{2,6}-\d+): /;
const DEFAULT_VAGUE_WORDS = [
  "quickly", "fast", "slowly", "gracefully", "appropriately", "properly", "correctly", "reasonable", "user-friendly",
  "robust", "seamless", "efficiently",
];
const KIND_LABEL = { always: "Must always hold", never: "Must never happen", eventually: "Must eventually happen", reachable: "Must be reachable" };
const REQUIRED_PROOF = {
  always: { types: ["property", "model"], journey: true },
  never: { types: ["property", "model"], journey: true },
  eventually: { types: ["simulation", "model"], journey: false },
  reachable: { types: ["reachability"], journey: false },
};

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const toPosix = (path) => path.split(sep).join("/");

function loadParser(root) {
  try {
    return createRequire(join(root, "package.json"))("oxc-parser").parseSync;
  } catch {
    throw new Error("oxc-parser is not installed. Add it as a dev dependency of this project.");
  }
}

function walk(root, dir, found = []) {
  const at = join(root, dir);
  if (!existsSync(at)) return found;
  for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name))) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(root, path, found);
    else found.push(path);
  }
  return found;
}

function visit(node, each) {
  if (Array.isArray(node)) {
    for (const item of node) visit(item, each);
  } else if (node !== null && typeof node === "object") {
    if (typeof node.type === "string") each(node);
    for (const value of Object.values(node)) visit(value, each);
  }
}

function plainString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return undefined;
}

// A plain literal's value, or a problem. Identifiers are allowed only in `proves`.
function literal(node, text, inProves = false) {
  const string = plainString(node);
  if (string !== undefined) return { value: string };
  if (node?.type === "Literal" && typeof node.value === "boolean") return { value: node.value };
  if (node?.type === "ArrayExpression") {
    const items = node.elements.map((each) =>
      inProves && each?.type === "Identifier" ? { value: each.name } : literal(each, text),
    );
    return items.find((each) => each.problem !== undefined) ?? { value: items.map((each) => each.value) };
  }
  if (node?.type === "ObjectExpression") return objectOf(node, text);
  return { problem: `not a plain literal: ${text.slice(node?.start ?? 0, node?.end ?? 0).slice(0, 60)}` };
}

function objectOf(node, text) {
  if (node?.type !== "ObjectExpression") return { problem: "first argument is not a plain object literal" };
  const value = {};
  for (const property of node.properties) {
    if (property.type !== "Property" || property.computed || property.shorthand) {
      return { problem: `not a plain property: ${text.slice(property.start, property.end).slice(0, 60)}` };
    }
    const name = property.key.name ?? property.key.value;
    const read = literal(property.value, text, name === "proves");
    if (read.problem !== undefined) return { problem: `${name}: ${read.problem}` };
    value[name] = read.value;
  }
  return { value };
}

function testCallName(callee) {
  if (callee.type === "Identifier") return TEST_NAMES.has(callee.name);
  if (callee.type === "MemberExpression" && !callee.computed) {
    return callee.object.type === "Identifier" && TEST_NAMES.has(callee.object.name) && TEST_MODIFIERS.has(callee.property.name);
  }
  if (callee.type === "CallExpression") {
    const inner = callee.callee;
    return inner.type === "MemberExpression" && inner.property.name === "each" && inner.object.type === "Identifier" && TEST_NAMES.has(inner.object.name);
  }
  return false;
}

const isFunction = (node) => node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";

function stepsIn(node, file, text, errors) {
  const steps = [];
  visit(node, (each) => {
    if (each.type === "CallExpression" && each.callee.type === "Identifier" && each.callee.name === "step") {
      const name = plainString(each.arguments[0]);
      if (name === undefined) errors.push(`${file}: step() needs a plain string name: ${text.slice(each.start, each.end).slice(0, 60)}`);
      else steps.push({ name, start: each.start });
    }
  });
  return steps.sort((a, b) => a.start - b.start).map((each) => each.name);
}

function readFile(root, parseSync, file, errors) {
  const text = readFileSync(join(root, file), "utf8");
  const parsed = parseSync(file, text, { lang: file.endsWith("x") ? "tsx" : "ts", sourceType: "module" });
  if (parsed.errors.length > 0) {
    errors.push(`${file}: ${parsed.errors[0].message}`);
    return undefined;
  }
  return { program: parsed.program, text };
}

function callsNamed(program, name) {
  const found = [];
  visit(program, (node) => {
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === name) found.push(node);
  });
  return found;
}

function readLaws(root, parseSync, errors, LAWS) {
  const laws = new Map();
  if (!existsSync(join(root, LAWS))) return laws;
  const read = readFile(root, parseSync, LAWS, errors);
  if (read === undefined) return laws;
  for (const statement of read.program.body) {
    if (statement.type !== "ExportNamedDeclaration" || statement.declaration?.type !== "VariableDeclaration") continue;
    for (const declaration of statement.declaration.declarations) {
      const init = declaration.init;
      if (init?.type !== "CallExpression" || init.callee.name !== "law") continue;
      const spec = objectOf(init.arguments[0], read.text);
      if (spec.problem !== undefined) errors.push(`${LAWS}: ${declaration.id.name}: ${spec.problem}`);
      else laws.set(declaration.id.name, spec.value);
    }
  }
  return laws;
}

function readFlows(root, parseSync, errors) {
  const flows = new Map();
  for (const file of walk(root, FLOWS).filter((each) => each.endsWith(".flow.ts"))) {
    const read = readFile(root, parseSync, file, errors);
    if (read === undefined) continue;
    const id = file.slice(FLOWS.length + 1, -".flow.ts".length);
    const calls = callsNamed(read.program, "flow");
    if (calls.length !== 1) {
      errors.push(`${file}: needs exactly one flow() call`);
      continue;
    }
    const spec = objectOf(calls[0].arguments[0], read.text);
    if (spec.problem !== undefined) errors.push(`${file}: ${spec.problem}`);
    else flows.set(id, { ...spec.value, id, file });
  }
  return flows;
}

function readProof(call, title, file, read, errors) {
  const spec = objectOf(call.arguments[0], read.text);
  if (spec.problem !== undefined) {
    errors.push(`${file}: ${title ?? "proof"}: ${spec.problem}`);
    return undefined;
  }
  return spec.value;
}

function readJourneyFile(root, parseSync, file, errors) {
  const read = readFile(root, parseSync, file, errors);
  if (read === undefined) return undefined;
  const calls = callsNamed(read.program, "journey");
  if (calls.length === 0) return { file, converted: false, read };
  if (calls.length > 1) {
    errors.push(`${file}: holds ${calls.length} journey() calls. Keep one journey per file.`);
    return undefined;
  }
  const spec = objectOf(calls[0].arguments[0], read.text);
  if (spec.problem !== undefined) {
    errors.push(`${file}: ${spec.problem}`);
    return undefined;
  }
  const tests = [];
  visit(calls[0].arguments[1], (node) => {
    if (node.type !== "CallExpression") return;
    const isProve = node.callee.type === "Identifier" && node.callee.name === "prove";
    if (!isProve && !(testCallName(node.callee) && isFunction(node.arguments.at(-1)))) return;
    const title = plainString(node.arguments[isProve ? 1 : 0]);
    if (title === undefined) {
      errors.push(`${file}: a test title isn't a plain string: ${read.text.slice(node.start, node.end).slice(0, 60)}`);
      return;
    }
    const proof = isProve ? readProof(node, title, file, read, errors) : {};
    tests.push({
      title,
      start: node.start,
      proves: proof?.proves ?? [],
      knownFailing: proof?.knownFailing,
      steps: stepsIn(node.arguments.at(-1), file, read.text, errors),
    });
  });
  tests.sort((a, b) => a.start - b.start);
  return { file, converted: true, read, spec: spec.value, tests };
}

function readChecks(root, parseSync, errors) {
  const checks = [];
  const reads = [];
  const files = walk(root, "").filter((file) => TEST_FILE.test(file) && !JOURNEY_FILE.test(file));
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    if (!/\bcheck\s*\(/.test(text)) continue;
    const read = readFile(root, parseSync, file, errors);
    if (read === undefined) continue;
    reads.push({ file, read });
    for (const call of callsNamed(read.program, "check")) {
      const first = call.arguments[0];
      if (first?.type !== "ObjectExpression") continue;
      const title = plainString(call.arguments[1]);
      const spec = readProof(call, title, file, read, errors);
      if (spec !== undefined) checks.push({ ...spec, title, file });
    }
  }
  return { checks, reads };
}

function readProject(root) {
  const parseSync = loadParser(root);
  const errors = [];
  const lawsFile = readConfig(root).laws ?? DEFAULT_LAWS;
  const laws = readLaws(root, parseSync, errors, lawsFile);
  const flows = readFlows(root, parseSync, errors);
  for (const file of walk(root, JOURNEYS)) {
    if (JOURNEY_FILE.test(file) && !file.startsWith(`${TESTS}/`)) errors.push(`${file}: journey files live in ${TESTS}/. Move it there`);
  }
  const journeyFiles = walk(root, TESTS)
    .filter((file) => JOURNEY_FILE.test(file))
    .map((file) => readJourneyFile(root, parseSync, file, errors))
    .filter((each) => each !== undefined);
  const { checks, reads } = readChecks(root, parseSync, errors);
  return {
    root,
    errors,
    lawsFile,
    laws,
    flows,
    journeys: journeyFiles.filter((each) => each.converted),
    notConverted: journeyFiles.filter((each) => !each.converted).map((each) => each.file),
    checks,
    sources: [...journeyFiles.map(({ file, read }) => ({ file, read })), ...reads],
  };
}

function dedent(chart) {
  const lines = chart.trim().split("\n");
  const indents = lines.slice(1).filter((line) => line.trim() !== "").map((line) => line.match(/^ */)[0].length);
  const indent = indents.length > 0 ? Math.min(...indents) : 0;
  return [lines[0], ...lines.slice(1).map((line) => line.slice(indent).trimEnd())].join("\n");
}

function lawsOfFlow(project, id) {
  const names = new Set();
  for (const journey of project.journeys.filter((each) => each.spec.flow === id)) {
    for (const test of journey.tests) for (const name of test.proves) names.add(name);
  }
  for (const check of project.checks.filter((each) => each.flow === id)) {
    for (const name of check.proves ?? []) names.add(name);
  }
  return [...names].filter((name) => project.laws.has(name)).sort(compare);
}

const cell = (text) => text.replace(/\|/g, "\\|");
const GENERATED = "<!-- Generated by journey-spec.mjs. Change the sources, not this page. -->";
const LEVEL_LABEL = { api: "the API", dom: "the page in a simulated DOM", browser: "the browser" };
const CRITICALITY_LABEL = { critical: "Critical", important: "Important", other: "Lower priority" };
const ROOT = "../..";
const linked = (path) => `[\`${path}\`](${ROOT}/${path})`;

function splitId(title) {
  const id = LINE_ID.exec(title)?.[1];
  return id === undefined ? { id: "", line: title } : { id, line: title.replace(LINE_ID, "") };
}

function journeysOfFlow(project, id) {
  return project.journeys
    .filter((each) => each.spec.flow === id)
    .sort((a, b) => CRITICALITY.indexOf(a.spec.criticality) - CRITICALITY.indexOf(b.spec.criticality) || compare(a.spec.title, b.spec.title));
}

function renderPromises(journeys) {
  const rows = journeys.flatMap(({ spec, tests }) => tests.map((test) => {
    const { id, line } = splitId(test.title);
    const laws = [test.proves.join(", "), ...(test.knownFailing !== undefined ? [`Fails today (${test.knownFailing})`] : [])].filter((each) => each !== "");
    return `| ${id} | ${cell(line)} | ${cell(spec.title)} | ${cell(laws.join(". "))} |`;
  }));
  if (rows.length === 0) return ["No journey tests yet.", ""];
  return ["| ID | Promise | Journey | Law |", "| --- | --- | --- | --- |", ...rows, ""];
}

function proofLabel(proof) {
  if (proof.journey) {
    const { id } = splitId(proof.title);
    return id === "" ? `the journey test "${proof.title}"` : id;
  }
  return `the ${proof.type} check in ${linked(proof.file)}`;
}

function renderLaw(project, name, law) {
  const says = law.says.replace(/\.$/, "");
  const proofs = proofsOf(project).filter((proof) => proof.proves.includes(name));
  const by = proofs.length > 0 ? ` Proved by ${proofs.map(proofLabel).join(" and ")}.` : " Nothing proves it yet.";
  const kind = KIND_LABEL[law.kind] ?? law.kind;
  if (law.knownBroken === undefined) return `- \`${name}\`. ${kind}: ${says}.${by}`;
  return `- \`${name}\`. ${kind}, but ${law.knownBroken.bug} breaks it today: ${says}. The fix is \`${law.knownBroken.fix}\`.${by}`;
}

function renderJourney({ file, spec, tests }) {
  const lines = [
    `### ${spec.title}`, "",
    `${CRITICALITY_LABEL[spec.criticality] ?? spec.criticality}. Drives ${LEVEL_LABEL[spec.level] ?? spec.level} from ${linked(file)}.`, "",
    `- Who: ${spec.persona}`,
    `- Starting point: ${spec.context}`,
    `- Goal: ${spec.intent}`, "",
    "Steps:", "",
  ];
  for (const test of tests) {
    const { id } = splitId(test.title);
    lines.push(`- ${id === "" ? test.title : id}`);
    test.steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
  }
  lines.push("");
  return lines;
}

function renderFlow(project, flow) {
  const journeys = journeysOfFlow(project, flow.id);
  const names = lawsOfFlow(project, flow.id);
  const kept = names.filter((name) => project.laws.get(name).knownBroken === undefined);
  const broken = names.filter((name) => project.laws.get(name).knownBroken !== undefined);
  const modelled = project.checks.some((each) => each.type === "model" && each.flow === flow.id);
  const terms = Object.entries(flow.terms ?? {}).sort(([a], [b]) => compare(a, b));
  const law = (name) => renderLaw(project, name, project.laws.get(name));
  const lines = [
    GENERATED, "",
    `# ${flow.title}`, "",
    flow.summary, "",
    "## What it promises", "",
    ...renderPromises(journeys),
    "## Laws", "",
    ...(kept.length > 0 ? [...kept.map(law), ""] : ["No laws cover this flow.", ""]),
    "## Known bugs", "",
    ...(broken.length > 0 ? [...broken.map(law), ""] : ["None.", ""]),
    "## States", "",
    modelled ? "A model check tests this chart against the code." : "No test checks this chart. People review it.", "",
    "```mermaid", dedent(flow.chart), "```", "",
    ...(journeys.length > 0 ? ["## Journeys", "", ...journeys.flatMap(renderJourney)] : []),
    ...(terms.length > 0 ? ["## Terms", "", ...terms.map(([term, meaning]) => `- ${term}: ${meaning}`), ""] : []),
    ...((flow.code ?? []).length > 0 ? ["## Code", "", ...flow.code.map((path) => `- ${linked(path)}`), ""] : []),
    ...((flow.decisions ?? []).length > 0 ? ["## Decisions", "", ...flow.decisions.map((path) => `- ${linked(path)}`), ""] : []),
  ];
  return lines.join("\n");
}

function renderIndex(project) {
  const flows = [...project.flows.values()].sort((a, b) => compare(a.title, b.title));
  const laws = [...project.laws.entries()].sort(([a], [b]) => compare(a, b));
  const row = (flow) => {
    const names = lawsOfFlow(project, flow.id);
    const promises = journeysOfFlow(project, flow.id).reduce((sum, { tests }) => sum + tests.length, 0);
    const broken = names.filter((name) => project.laws.get(name).knownBroken !== undefined).length;
    return `| [${flow.title}](${flow.id}.md) | ${promises} | ${names.length - broken} | ${broken} |`;
  };
  const lines = [
    GENERATED, "",
    "# Journeys", "",
    "## Flows", "",
    ...(flows.length > 0 ? ["| Flow | Promises | Laws | Known bugs |", "| --- | --- | --- | --- |", ...flows.map(row), ""] : ["No flows yet.", ""]),
    "## Laws", "",
    ...(laws.length > 0 ? [...laws.map(([name, law]) => renderLaw(project, name, law)), ""] : ["No laws yet.", ""]),
    ...(project.notConverted.length > 0 ? ["## Not converted yet", "", "These journey files have no `journey()` metadata, so no page lists them.", "", ...project.notConverted.map((file) => `- ${linked(file)}`), ""] : []),
  ];
  return lines.join("\n");
}

function renderPages(project) {
  const pages = new Map([[`${PAGES}/README.md`, renderIndex(project)]]);
  for (const flow of project.flows.values()) pages.set(`${PAGES}/${flow.id}.md`, renderFlow(project, flow));
  return pages;
}

function titleProblem(fullTitle, vague) {
  const title = fullTitle.replace(LINE_ID, "");
  if (!/^(WHEN|WHILE|IF|WHERE|THE)\b/.test(title)) return "doesn't start with WHEN, WHILE, IF, WHERE, or THE";
  const shalls = title.match(/\bSHALL\b/g)?.length ?? 0;
  if (shalls === 0) return "has no SHALL";
  if (shalls > 1) return "has more than one SHALL";
  if (/^IF\b/.test(title) && !/\bTHEN\b/.test(title)) return "has IF with no THEN";
  const word = vague.find((each) => new RegExp(`(^|[^\\w-])${each}($|[^\\w-])`, "i").test(title));
  return word === undefined ? undefined : `uses the vague word "${word}"`;
}

function readConfig(root) {
  const path = join(root, CONFIG);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

const vagueWords = (root) => readConfig(root).vagueWords ?? DEFAULT_VAGUE_WORDS;

// An ID names one approved line, so it sits on one test, and a retired ID is never used again.
// Its prefix names the feature that owns the line, as listed in the config's prefixes.
function checkLineIds(project, errors, warnings) {
  const config = readConfig(project.root);
  const retired = new Set(config.retiredIds ?? []);
  const prefixes = config.prefixes ?? {};
  const owner = new Map();
  for (const [feature, prefix] of Object.entries(prefixes)) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(feature)) errors.push(`${CONFIG}: feature "${feature}" must be a kebab-case name`);
    if (!/^[A-Z]{2,6}$/.test(prefix)) errors.push(`${CONFIG}: prefix "${prefix}" for ${feature} must be 2 to 6 capital letters`);
    if (owner.has(prefix)) errors.push(`${CONFIG}: prefix ${prefix} belongs to both ${owner.get(prefix)} and ${feature}. Give each feature its own`);
    else owner.set(prefix, feature);
  }
  const used = new Set();
  const seen = new Map();
  for (const { file, tests } of project.journeys) {
    for (const test of tests) {
      const id = LINE_ID.exec(test.title)?.[1];
      if (id === undefined) continue;
      const prefix = id.split("-")[0];
      used.add(prefix);
      if (!owner.has(prefix)) errors.push(`${file}: prefix ${prefix} isn't in prefixes in ${CONFIG}. Add the feature that owns it, such as "prefixes": { "<feature>": "${prefix}" }: ${test.title}`);
      if (retired.has(id)) errors.push(`${file}: ${id} is retired and can't be used again: ${test.title}`);
      if (seen.has(id)) errors.push(`${file}: ${id} is also on a test in ${seen.get(id)}. Give each ID one test`);
      else seen.set(id, file);
    }
  }
  for (const [prefix, feature] of owner) {
    if (!used.has(prefix)) warnings.push(`${CONFIG}: ${feature} (${prefix}) has no tests left. Remove it if the feature is gone`);
  }
}

function nextIds(project) {
  const config = readConfig(project.root);
  const highest = new Map(Object.values(config.prefixes ?? {}).map((prefix) => [prefix, 0]));
  const ids = [...(config.retiredIds ?? []), ...project.journeys.flatMap(({ tests }) => tests.map((test) => LINE_ID.exec(test.title)?.[1]))];
  for (const id of ids) {
    if (id === undefined) continue;
    const [prefix, n] = id.split("-");
    highest.set(prefix, Math.max(highest.get(prefix) ?? 0, Number(n)));
  }
  return [...highest].map(([prefix, n]) => `${prefix}-${n + 1}`);
}

// For each patch: who names it, the fix to apply first for a known bug, and the proofs to run.
function patchList(project) {
  const entries = new Map();
  const entry = (patch) => {
    if (!entries.has(patch)) entries.set(patch, { patch, owners: [], proofs: [] });
    return entries.get(patch);
  };
  const add = (patch, owner, proofs, fix) => {
    const each = entry(patch);
    each.owners.push(owner);
    if (fix !== undefined) each.fix = fix;
    for (const { file, title } of proofs) {
      if (!each.proofs.some((proof) => proof.file === file && proof.title === title)) each.proofs.push({ file, title });
    }
  };
  const proofs = proofsOf(project);
  for (const [name, law] of project.laws) {
    const own = proofs.filter((proof) => proof.proves.includes(name));
    for (const patch of law.breakWith ?? []) add(patch, `law ${name}`, own, law.knownBroken?.fix);
  }
  for (const { file, spec, tests } of project.journeys) {
    for (const patch of spec.breakWith ?? []) add(patch, `journey ${spec.title}`, tests.map(({ title }) => ({ file, title })));
  }
  for (const check of project.checks) {
    for (const patch of check.breakWith ?? []) add(patch, `check ${check.title}`, [check]);
  }
  return [...entries.values()].sort((a, b) => a.patch.localeCompare(b.patch));
}

function checkJourneys(project, errors) {
  const vague = vagueWords(project.root);
  for (const { file, spec, tests } of project.journeys) {
    for (const field of REQUIRED_JOURNEY_FIELDS) {
      if (spec[field] === undefined) errors.push(`${file}: journey has no ${field}`);
    }
    if (spec.criticality !== undefined && !CRITICALITY.includes(spec.criticality)) errors.push(`${file}: unknown criticality "${spec.criticality}"`);
    if (spec.level !== undefined && !LEVELS.includes(spec.level)) errors.push(`${file}: unknown level "${spec.level}"`);
    if (spec.flow !== undefined && !project.flows.has(spec.flow)) errors.push(`${file}: flow "${spec.flow}" has no ${FLOWS}/${spec.flow}.flow.ts`);
    if (tests.length === 0) errors.push(`${file}: journey has no tests`);
    for (const test of tests) {
      const problem = titleProblem(test.title, vague);
      if (problem !== undefined) errors.push(`${file}: title ${problem}: ${test.title}`);
    }
  }
}

function checkFlows(project, errors) {
  for (const flow of project.flows.values()) {
    for (const field of ["title", "summary"]) {
      if (flow[field] === undefined) errors.push(`${flow.file}: flow has no ${field}`);
    }
    if (typeof flow.chart !== "string") errors.push(`${flow.file}: flow has no chart`);
    else if (!flow.chart.trim().startsWith("stateDiagram-v2")) errors.push(`${flow.file}: chart must start with stateDiagram-v2`);
    for (const path of [...(flow.code ?? []), ...(flow.decisions ?? [])]) {
      if (!existsSync(join(project.root, path))) errors.push(`${flow.file}: linked path doesn't exist: ${path}`);
    }
    const broken = lawsOfFlow(project, flow.id).filter((name) => project.laws.get(name).knownBroken !== undefined);
    if (broken.length > 0 && !/\bbroken\b/.test(flow.chart ?? "")) errors.push(`${flow.file}: ${broken.join(", ")} is a known bug, so the chart needs a broken state`);
  }
}

function proofsOf(project) {
  const journey = project.journeys.flatMap(({ file, tests }) => tests.map((test) => ({ ...test, file, journey: true })));
  return [...journey, ...project.checks.map((check) => ({ ...check, proves: check.proves ?? [], journey: false }))];
}

function checkLaws(project, errors) {
  const LAWS = project.lawsFile;
  const proofs = proofsOf(project);
  for (const proof of proofs) {
    for (const name of proof.proves) {
      if (!project.laws.has(name)) errors.push(`${proof.file}: proves ${name}, which isn't a law`);
    }
    if (proof.knownFailing !== undefined) {
      const matched = proof.proves.some((name) => project.laws.get(name)?.knownBroken?.bug === proof.knownFailing);
      if (!matched) errors.push(`${proof.file}: knownFailing ${proof.knownFailing} matches no knownBroken law it proves`);
    }
  }
  for (const [name, law] of project.laws) {
    const rule = REQUIRED_PROOF[law.kind];
    if (rule === undefined) {
      errors.push(`${LAWS}: ${name} has an unknown kind "${law.kind}"`);
      continue;
    }
    const own = proofs.filter((proof) => proof.proves.includes(name));
    if (!own.some((proof) => rule.types.includes(proof.type))) errors.push(`${LAWS}: ${name} needs a ${rule.types.join(" or ")} check`);
    if (rule.journey && !own.some((proof) => proof.journey)) errors.push(`${LAWS}: ${name} needs a journey test`);
    if (law.knownBroken !== undefined) {
      if (!own.some((proof) => proof.knownFailing === law.knownBroken.bug)) errors.push(`${LAWS}: ${name} is knownBroken, but no proof is knownFailing ${law.knownBroken.bug}`);
      if (typeof law.knownBroken.fix !== "string") errors.push(`${LAWS}: ${name} knownBroken has no fix`);
    }
  }
  for (const { file, read } of project.sources) {
    visit(read.program, (node) => {
      if (node.type !== "ImportDeclaration" || !/(^|\/)laws(\.[cm]?[jt]s)?$/.test(node.source.value)) return;
      for (const specifier of node.specifiers) {
        const imported = specifier.imported?.name ?? specifier.imported?.value;
        if (specifier.type !== "ImportSpecifier") errors.push(`${file}: import laws by name`);
        else if (imported !== specifier.local.name) errors.push(`${file}: renames the law ${imported} on import`);
      }
    });
  }
}

function checkPatches(project, errors) {
  const LAWS = project.lawsFile;
  const named = new Set();
  const need = (owner, path) => {
    named.add(path);
    if (!existsSync(join(project.root, path))) errors.push(`${owner}: patch doesn't exist: ${path}`);
  };
  const list = (owner, value) => {
    if (value === undefined) return [];
    if (Array.isArray(value)) return value;
    errors.push(`${owner}: breakWith must be a list`);
    return [];
  };
  for (const [name, law] of project.laws) {
    for (const patch of list(`${LAWS}: ${name}`, law.breakWith)) need(`${LAWS}: ${name}`, patch);
    if (typeof law.knownBroken?.fix === "string") need(`${LAWS}: ${name}`, law.knownBroken.fix);
  }
  for (const { file, spec } of project.journeys) for (const patch of list(file, spec.breakWith)) need(file, patch);
  for (const check of project.checks) for (const patch of list(check.file, check.breakWith)) need(check.file, patch);
  for (const file of walk(project.root, BREAKS)) {
    if (!named.has(file)) errors.push(`${file}: nothing names this patch`);
  }
}

function checkPages(project, errors) {
  const pages = renderPages(project);
  for (const [file, page] of pages) {
    const path = join(project.root, file);
    if (!existsSync(path)) errors.push(`${file}: page is missing. Run generate.`);
    else if (readFileSync(path, "utf8") !== page) errors.push(`${file}: page is stale or was edited by hand. Run generate.`);
  }
  const docs = join(project.root, PAGES);
  for (const entry of existsSync(docs) ? readdirSync(docs) : []) {
    const file = `${PAGES}/${entry}`;
    if (entry.endsWith(".md") && !pages.has(file)) errors.push(`${file}: no flow makes this page`);
  }
}

// What stops a page being written at all. check reports these through its own checks.
function pageProblems(project) {
  const problems = [];
  for (const { file, spec } of project.journeys) {
    if (!project.flows.has(spec.flow)) problems.push(`${file}: flow "${spec.flow}" has no ${FLOWS}/${spec.flow}.flow.ts`);
  }
  for (const flow of project.flows.values()) {
    for (const field of ["title", "summary", "chart"]) {
      if (typeof flow[field] !== "string") problems.push(`${flow.file}: flow has no ${field}`);
    }
  }
  return problems;
}

function report(errors) {
  for (const error of errors) console.error(`  ${error}`);
  console.error(`journey-spec: ${errors.length} problem${errors.length === 1 ? "" : "s"}`);
  process.exitCode = 1;
}

function main() {
  const command = process.argv[2];
  if (!["generate", "check", "next-ids", "patches"].includes(command)) {
    console.error("usage: journey-spec.mjs generate|check|next-ids|patches");
    process.exitCode = 2;
    return;
  }
  const root = process.cwd();
  const project = readProject(root);
  if (command === "next-ids") {
    const ids = nextIds(project);
    console.log(ids.length > 0 ? ids.join("\n") : `journey-spec: no prefixes in ${CONFIG} yet`);
    return;
  }
  if (command === "patches") {
    if (project.errors.length > 0) return report(project.errors);
    console.log(JSON.stringify(patchList(project), null, 2));
    return;
  }
  if (command === "generate") {
    const problems = [...project.errors, ...pageProblems(project)];
    if (problems.length > 0) return report(problems);
    const pages = renderPages(project);
    mkdirSync(join(root, PAGES), { recursive: true });
    for (const entry of readdirSync(join(root, PAGES))) {
      const file = `${PAGES}/${entry}`;
      if (entry.endsWith(".md") && !pages.has(file) && readFileSync(join(root, file), "utf8").startsWith("<!-- Generated by journey-spec.mjs")) rmSync(join(root, file));
    }
    for (const [file, page] of pages) writeFileSync(join(root, file), page);
    console.log(`journey-spec: wrote ${pages.size} page${pages.size === 1 ? "" : "s"}`);
    return;
  }
  const errors = [...project.errors];
  const warnings = [];
  checkJourneys(project, errors);
  checkLineIds(project, errors, warnings);
  checkFlows(project, errors);
  checkLaws(project, errors);
  checkPatches(project, errors);
  if (project.errors.length === 0 && pageProblems(project).length === 0) checkPages(project, errors);
  for (const warning of warnings) console.log(`note: ${warning}`);
  if (errors.length > 0) return report(errors);
  console.log(`journey-spec: ok. ${project.journeys.length} converted, ${project.notConverted.length} not converted yet.`);
}

try {
  main();
} catch (error) {
  console.error(`journey-spec: ${error.message}`);
  process.exitCode = 1;
}
