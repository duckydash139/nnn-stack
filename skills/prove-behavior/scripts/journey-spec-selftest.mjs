#!/usr/bin/env node
// Proves journey-spec.mjs can fail. Each scenario breaks one thing in a small project and must fail
// for that reason. Run it from any directory whose node_modules holds oxc-parser.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "journey-spec.mjs");
const MODULES = resolve("node_modules");

const JOURNEY = `import { NoDoubleCharge } from "../../laws";
throw new Error("journey files must never run");
journey({
  title: "Buy with a saved card",
  criticality: "critical",
  level: "api",
  flow: "checkout",
  paths: ["src/"],
  persona: "Returning customer",
  context: "One item in the cart",
  intent: "Pay and get a confirmation",
  breakWith: ["breaks/skip-status.patch"],
}, () => {
  test("WHEN a customer pays, THE SYSTEM SHALL confirm the order", async () => {
    await step("Submit the cart", () => 1);
    await step("Confirm payment", () => 2);
  });
  prove({ proves: [NoDoubleCharge] }, "IF two tabs submit the same cart, THEN THE SYSTEM SHALL charge once", async () => {
    await step("Submit from both tabs", () => 3);
  });
});
`;
const FILES = {
  "package.json": "{}",
  "laws.ts": `export const NoDoubleCharge = law({
  kind: "never",
  over: "any order of retries",
  says: "A customer is charged twice for one order",
  breakWith: ["breaks/no-key.patch"],
});
`,
  "journeys/flows/checkout.flow.ts": `flow({
  title: "Checkout",
  summary: "A customer pays for their cart.",
  terms: { "Saved card": "A token kept with the provider" },
  code: ["src/pay.ts"],
  decisions: [],
  chart: \`stateDiagram-v2
    [*] --> Cart
    Cart --> Paid\`,
});
`,
  "journeys/tests/buy.journey.test.ts": JOURNEY,
  "journeys/tests/old.journey.test.ts": `test("old title stays", () => {});\n`,
  "src/pay.test.ts": `import { NoDoubleCharge } from "../laws";
check({ type: "property", proves: [NoDoubleCharge] }, "THE SYSTEM SHALL charge at most once, for any order of retries", () => {});
`,
  "src/pay.ts": "export const pay = 1;\n",
  "breaks/no-key.patch": "x\n",
  "breaks/skip-status.patch": "x\n",
};

const base = mkdtempSync(join(tmpdir(), "journey-spec-"));
const run = (dir, command) => {
  const result = spawnSync(process.execPath, [SCRIPT, command], { cwd: dir, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};
const write = (dir, file, text) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
};
const edit = (dir, file, from, to) => {
  const text = readFileSync(join(dir, file), "utf8");
  if (!text.includes(from)) throw new Error(`scenario broke nothing: ${from}`);
  write(dir, file, text.replace(from, to));
};

const good = join(base, "good");
for (const [file, text] of Object.entries(FILES)) write(good, file, text);
symlinkSync(MODULES, join(good, "node_modules"));

let failures = 0;
const pass = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${detail}`}`);
};

const generated = run(good, "generate");
pass("generate writes the pages", generated.status === 0, generated.output);
const first = readFileSync(join(good, "journeys/docs/checkout.md"), "utf8");
const index = readFileSync(join(good, "journeys/docs/README.md"), "utf8");
const clean = run(good, "check");
pass("a good project passes", clean.status === 0, clean.output);
pass("counts converted and unconverted journeys", clean.output.includes("1 converted, 1 not converted"), clean.output);
run(good, "generate");
pass("generating twice gives identical bytes", readFileSync(join(good, "journeys/docs/checkout.md"), "utf8") === first);
for (const expected of [
  "```mermaid\nstateDiagram-v2\n[*] --> Cart",
  "Critical. Drives the API from [`journeys/tests/buy.journey.test.ts`](../../journeys/tests/buy.journey.test.ts).",
  "  2. Confirm payment",
  "| Buy with a saved card | NoDoubleCharge |",
  "- `NoDoubleCharge`. Must never happen: A customer is charged twice",
  "No test checks this chart. People review it.",
  "- Saved card: A token kept",
]) pass(`the page holds: ${expected.split("\n")[0]}`, first.includes(expected), first);
pass("the index lists a journey not converted yet", index.includes("`journeys/tests/old.journey.test.ts`"), index);

const CASES = [
  ["a hand edit to a page", (d) => edit(d, "journeys/docs/checkout.md", "A customer pays", "Someone pays"), "stale or was edited"],
  ["a journey change with no regenerated page", (d) => edit(d, "journeys/tests/buy.journey.test.ts", "One item in the cart", "Two items"), "stale or was edited"],
  ["a chart change with no regenerated page", (d) => edit(d, "journeys/flows/checkout.flow.ts", "Cart --> Paid", "Cart --> Failed"), "stale or was edited"],
  ["a page with no flow", (d) => write(d, "journeys/docs/stray.md", "# Stray\n"), "no flow makes this page"],
  ["a journey flow with no flow file", (d) => edit(d, "journeys/tests/buy.journey.test.ts", 'flow: "checkout"', 'flow: "nope"'), 'flow "nope" has no'],
  ["a flow with no chart", (d) => edit(d, "journeys/flows/checkout.flow.ts", /chart: [^]*?`,\n/.exec(FILES["journeys/flows/checkout.flow.ts"])[0], ""), "flow has no chart"],
  ["a chart of the wrong type", (d) => edit(d, "journeys/flows/checkout.flow.ts", "stateDiagram-v2", "flowchart TD"), "must start with stateDiagram-v2"],
  ["a code path that doesn't exist", (d) => edit(d, "journeys/flows/checkout.flow.ts", "src/pay.ts", "src/gone.ts"), "linked path doesn't exist"],
  ["a title with no EARS pattern", (d) => edit(d, "journeys/tests/buy.journey.test.ts", "WHEN a customer pays, THE SYSTEM SHALL confirm the order", "confirms the order"), "doesn't start with"],
  ["a title with no SHALL", (d) => edit(d, "journeys/tests/buy.journey.test.ts", "WHEN a customer pays, THE SYSTEM SHALL confirm", "WHEN a customer pays, THE SYSTEM confirms"), "has no SHALL"],
  ["a title with two SHALLs", (d) => edit(d, "journeys/tests/buy.journey.test.ts", "SHALL confirm the order", "SHALL confirm and SHALL email"), "more than one SHALL"],
  ["an IF with no THEN", (d) => edit(d, "journeys/tests/buy.journey.test.ts", "same cart, THEN THE", "same cart, THE"), "IF with no THEN"],
  ["a title with a vague word", (d) => edit(d, "journeys/tests/buy.journey.test.ts", "SHALL confirm the order", "SHALL quickly confirm the order"), 'vague word "quickly"'],
  ["an ID used on two tests", (d) => {
    write(d, "journeys/spec.json", JSON.stringify({ prefixes: { payments: "PAY" } }));
    edit(d, "journeys/tests/buy.journey.test.ts", '"WHEN a customer pays', '"PAY-1: WHEN a customer pays');
    edit(d, "journeys/tests/buy.journey.test.ts", '"IF two tabs', '"PAY-1: IF two tabs');
  }, "Give each ID one test"],
  ["a retired ID", (d) => {
    edit(d, "journeys/tests/buy.journey.test.ts", '"WHEN a customer pays', '"PAY-2: WHEN a customer pays');
    write(d, "journeys/spec.json", JSON.stringify({ prefixes: { payments: "PAY" }, retiredIds: ["PAY-2"] }));
  }, "PAY-2 is retired"],
  ["an ID whose prefix isn't listed", (d) => edit(d, "journeys/tests/buy.journey.test.ts", '"WHEN a customer pays', '"PAY-1: WHEN a customer pays'), "prefix PAY isn't in prefixes"],
  ["two features with one prefix", (d) => {
    write(d, "journeys/spec.json", JSON.stringify({ prefixes: { payments: "PAY", payouts: "PAY" } }));
    edit(d, "journeys/tests/buy.journey.test.ts", '"WHEN a customer pays', '"PAY-1: WHEN a customer pays');
  }, "belongs to both payments and payouts"],
  ["a prefix that isn't capital letters", (d) => write(d, "journeys/spec.json", JSON.stringify({ prefixes: { payments: "pay" } })), "must be 2 to 6 capital letters"],
  ["a computed test title", (d) => edit(d, "journeys/tests/buy.journey.test.ts", '"WHEN a customer pays, THE SYSTEM SHALL confirm the order"', "name"), "isn't a plain string"],
  ["a computed step name", (d) => edit(d, "journeys/tests/buy.journey.test.ts", '"Submit the cart"', "name"), "plain string name"],
  ["a journey() argument that isn't a plain literal", (d) => edit(d, "journeys/tests/buy.journey.test.ts", 'persona: "Returning customer"', "persona: who"), "not a plain literal"],
  ["a spread in journey()", (d) => edit(d, "journeys/tests/buy.journey.test.ts", 'persona: "Returning customer"', "...shared"), "not a plain property"],
  ["a journey file outside journeys/tests", (d) => write(d, "journeys/stray.journey.test.ts", JOURNEY), "journey files live in journeys/tests/"],
  ["two journeys in one file", (d) => write(d, "journeys/tests/buy.journey.test.ts", `${JOURNEY}journey({}, () => {});\n`), "Keep one journey per file"],
  ["a never law with no property or model check", (d) => write(d, "src/pay.test.ts", ""), "needs a property or model check"],
  ["a never law with no journey test", (d) => edit(d, "journeys/tests/buy.journey.test.ts", "prove({ proves: [NoDoubleCharge] }, ", "prove({}, "), "needs a journey test"],
  ["an eventually law with only a property check", (d) => {
    edit(d, "laws.ts", 'kind: "never"', 'kind: "eventually"');
  }, "needs a simulation or model check"],
  ["a renamed law import", (d) => {
    edit(d, "journeys/tests/buy.journey.test.ts", 'import { NoDoubleCharge } from "../../laws";', 'import { NoDoubleCharge as Once } from "../../laws";');
  }, "renames the law NoDoubleCharge"],
  ["a proves entry that isn't a law", (d) => edit(d, "journeys/tests/buy.journey.test.ts", "proves: [NoDoubleCharge]", "proves: [NoSuchLaw]"), "NoSuchLaw, which isn't a law"],
  ["a breakWith that isn't a list", (d) => edit(d, "laws.ts", '["breaks/no-key.patch"]', '"breaks/no-key.patch"'), "breakWith must be a list"],
  ["a patch file that doesn't exist", (d) => rmSync(join(d, "breaks/no-key.patch")), "patch doesn't exist"],
  ["a patch nothing names", (d) => write(d, "breaks/orphan.patch", "x\n"), "nothing names this patch"],
  ["a knownFailing proof with no matching law", (d) => edit(d, "journeys/tests/buy.journey.test.ts", "proves: [NoDoubleCharge] }", 'proves: [NoDoubleCharge], knownFailing: "BUG-1" }'), "matches no knownBroken law"],
  ["a known bug with no knownFailing proof", (d) => {
    edit(d, "laws.ts", 'breakWith: ["breaks/no-key.patch"],', 'breakWith: ["breaks/no-key.patch"],\n  knownBroken: { bug: "BUG-1", fix: "breaks/fixes/add-key.patch" },');
    write(d, "breaks/fixes/add-key.patch", "x\n");
  }, "no proof is knownFailing BUG-1"],
  ["a known bug with no broken state", (d) => {
    edit(d, "laws.ts", 'breakWith: ["breaks/no-key.patch"],', 'breakWith: ["breaks/no-key.patch"],\n  knownBroken: { bug: "BUG-1", fix: "breaks/fixes/add-key.patch" },');
    write(d, "breaks/fixes/add-key.patch", "x\n");
    edit(d, "journeys/tests/buy.journey.test.ts", "proves: [NoDoubleCharge] }", 'proves: [NoDoubleCharge], knownFailing: "BUG-1" }');
  }, "chart needs a broken state"],
];

let serial = 0;
for (const [name, breakIt, reason] of CASES) {
  serial += 1;
  const dir = join(base, `case-${serial}`);
  cpSync(good, dir, { recursive: true, verbatimSymlinks: true });
  breakIt(dir);
  const result = run(dir, "check");
  pass(`fails on ${name}`, result.status === 1 && result.output.includes(reason), `wanted "${reason}", got status ${result.status}: ${result.output}`);
}

const known = join(base, "known");
cpSync(good, known, { recursive: true, verbatimSymlinks: true });
edit(known, "laws.ts", 'breakWith: ["breaks/no-key.patch"],', 'breakWith: ["breaks/no-key.patch"],\n  knownBroken: { bug: "BUG-1", fix: "breaks/fixes/add-key.patch" },');
write(known, "breaks/fixes/add-key.patch", "x\n");
edit(known, "journeys/tests/buy.journey.test.ts", "proves: [NoDoubleCharge] }", 'proves: [NoDoubleCharge], knownFailing: "BUG-1" }');
edit(known, "journeys/flows/checkout.flow.ts", "Cart --> Paid", "Cart --> Paid\n    Paid --> Charged:::broken");
run(known, "generate");
const knownPage = readFileSync(join(known, "journeys/docs/checkout.md"), "utf8");
pass("a known bug passes when all three records agree", run(known, "check").status === 0, run(known, "check").output);
pass("a broken law is listed under Known bugs, not Laws", /## Laws\n\nNo laws cover this flow./.test(knownPage) && knownPage.includes("Must never happen, but BUG-1 breaks it today") && knownPage.includes("Fails today (BUG-1)"), knownPage);

const modelled = join(base, "modelled");
cpSync(good, modelled, { recursive: true, verbatimSymlinks: true });
edit(modelled, "src/pay.test.ts", 'type: "property"', 'type: "model", flow: "checkout"');
run(modelled, "generate");
pass("a model check changes the trust line", readFileSync(join(modelled, "journeys/docs/checkout.md"), "utf8").includes("A model check tests this chart against the code."));

const withId = join(base, "with-id");
cpSync(good, withId, { recursive: true, verbatimSymlinks: true });
write(withId, "journeys/spec.json", JSON.stringify({ prefixes: { payments: "PAY", refunds: "REF" } }));
edit(withId, "journeys/tests/buy.journey.test.ts", '"WHEN a customer pays', '"PAY-1: WHEN a customer pays');
run(withId, "generate");
const withIdCheck = run(withId, "check");
pass("a title that starts with a listed line ID passes", withIdCheck.status === 0, withIdCheck.output);
pass("a listed feature with no tests is a note, not a failure", withIdCheck.output.includes("refunds (REF) has no tests left"), withIdCheck.output);
write(withId, "journeys/spec.json", JSON.stringify({ prefixes: { payments: "PAY", refunds: "REF" }, retiredIds: ["PAY-4"] }));
const next = run(withId, "next-ids");
pass("next-ids skips used and retired numbers", next.status === 0 && next.output === "PAY-5\nREF-1\n", next.output);

const listed = run(good, "patches");
let patches = [];
try {
  patches = JSON.parse(listed.output);
} catch {}
const byPatch = new Map(patches.map((each) => [each.patch, each]));
const lawPatch = byPatch.get("breaks/no-key.patch");
const journeyPatch = byPatch.get("breaks/skip-status.patch");
pass(
  "patches lists each patch with its owners and proofs",
  listed.status === 0 &&
    lawPatch?.owners.join() === "law NoDoubleCharge" &&
    lawPatch.proofs.map(({ file }) => file).sort().join() === "journeys/tests/buy.journey.test.ts,src/pay.test.ts" &&
    journeyPatch?.owners.join() === "journey Buy with a saved card" &&
    journeyPatch.proofs.length === 2,
  listed.output,
);

const moved = join(base, "moved-laws");
cpSync(good, moved, { recursive: true, verbatimSymlinks: true });
write(moved, "packages/spec/laws.ts", readFileSync(join(moved, "laws.ts"), "utf8"));
rmSync(join(moved, "laws.ts"));
write(moved, "journeys/spec.json", JSON.stringify({ laws: "packages/spec/laws.ts" }));
edit(moved, "journeys/tests/buy.journey.test.ts", 'from "../../laws"', 'from "@shop/spec/laws"');
edit(moved, "src/pay.test.ts", 'from "../laws"', 'from "@shop/spec/laws"');
run(moved, "generate");
const movedCheck = run(moved, "check");
pass("a laws file moved by spec.json passes", movedCheck.status === 0, movedCheck.output);
edit(moved, "packages/spec/laws.ts", 'kind: "never"', 'kind: "eventually"');
const movedBroken = run(moved, "check");
pass("a moved laws file is still checked", movedBroken.status === 1 && movedBroken.output.includes("packages/spec/laws.ts: NoDoubleCharge needs a simulation or model check"), movedBroken.output);

const unpatched = join(base, "unpatched");
cpSync(good, unpatched, { recursive: true, verbatimSymlinks: true });
edit(unpatched, "laws.ts", 'breakWith: ["breaks/no-key.patch"],', "");
edit(unpatched, "journeys/tests/buy.journey.test.ts", 'breakWith: ["breaks/skip-status.patch"],', "");
rmSync(join(unpatched, "breaks"), { recursive: true });
run(unpatched, "generate");
const unpatchedCheck = run(unpatched, "check");
pass("a law and a critical journey with no breakWith pass", unpatchedCheck.status === 0, unpatchedCheck.output);

const effectful = join(base, "effect-tests");
cpSync(good, effectful, { recursive: true, verbatimSymlinks: true });
edit(effectful, "journeys/tests/buy.journey.test.ts", 'test("WHEN a customer pays', 'it.effect("WHEN a customer pays');
edit(effectful, "journeys/tests/buy.journey.test.ts", "  });\n  prove(", '  });\n  it.prop("IF a customer pays twice, THEN THE SYSTEM SHALL keep one order", [], () => {\n    step("Pay twice", () => 4);\n  });\n  prove(');
run(effectful, "generate");
const effectPage = readFileSync(join(effectful, "journeys/docs/checkout.md"), "utf8");
pass("it.effect and it.prop tests are read as journey tests", effectPage.includes("- WHEN a customer pays, THE SYSTEM SHALL confirm the order\n  1. Submit the cart") && effectPage.includes("- IF a customer pays twice, THEN THE SYSTEM SHALL keep one order\n  1. Pay twice"), effectPage);

const dom = join(base, "dom-level");
cpSync(good, dom, { recursive: true, verbatimSymlinks: true });
edit(dom, "journeys/tests/buy.journey.test.ts", 'level: "api"', 'level: "dom"');
run(dom, "generate");
const domCheck = run(dom, "check");
pass("a dom journey passes and says it drives a simulated DOM", domCheck.status === 0 && readFileSync(join(dom, "journeys/docs/checkout.md"), "utf8").includes("Drives the page in a simulated DOM from"), domCheck.output);

const stale = join(base, "stale");
cpSync(good, stale, { recursive: true, verbatimSymlinks: true });
rmSync(join(stale, "journeys/flows/checkout.flow.ts"));
const refused = run(stale, "generate");
pass("generate refuses a journey whose flow is gone", refused.status === 1, refused.output);

const missing = join(base, "no-parser");
mkdirSync(missing);
write(missing, "package.json", "{}");
const noParser = run(missing, "check");
pass("a missing parser says so", noParser.status === 1 && noParser.output.includes("oxc-parser is not installed"), noParser.output);

rmSync(base, { recursive: true, force: true });
console.log(failures === 0 ? "all passed" : `${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
