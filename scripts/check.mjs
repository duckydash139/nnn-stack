#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "skills");

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const skillNames = new Set(readdirSync(SKILLS).filter((n) => statSync(join(SKILLS, n)).isDirectory()));
const problems = [];
const report = (file, msg) => problems.push(`${relative(ROOT, file)}: ${msg}`);

const BANNED = [
  [/\b(poteto-mode|poteto-agent|setup-pstack|pstack-models|cursor-team-kit)\b/, "points at a skill or config this repo replaced"],
  [/\bgrok-\d/, "names a Cursor model slug. Use an nnn-mode role"],
  [/~?\/?\.cursor\//, "names a Cursor path. Use the Claude Code path"],
  [/^(<<<<<<<|>>>>>>>) /m, "has a merge conflict marker"],
];

for (const name of skillNames) {
  const file = join(SKILLS, name, "SKILL.md");
  if (!existsSync(file)) {
    report(join(SKILLS, name), "has no SKILL.md");
    continue;
  }
  const fm = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, "utf8"))?.[1] ?? "";
  if (/^name:\s*(\S+)/m.exec(fm)?.[1] !== name) report(file, `frontmatter name does not match the folder \`${name}\``);
  if (!/^description:/m.test(fm)) report(file, "frontmatter has no description");
}

const files = walk(SKILLS).filter((f) => f.endsWith(".md") && !/LICENSE/.test(f));
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const [re, msg] of BANNED) if (re.test(text)) report(file, msg);

  const prose = text.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "");
  for (const [, link] of prose.matchAll(/\]\(([^)#\s]+)/g)) {
    if (/^(https?:|mailto:)/.test(link) || ["url", "/AGENTS.md"].includes(link)) continue;
    const target = link.startsWith("/") ? join(ROOT, link) : join(dirname(file), link);
    if (!existsSync(target)) report(file, `broken link \`${link}\``);
  }

  for (const [, skill] of text.matchAll(/the \*\*([a-z][a-z0-9-]+)\*\* skill/g)) {
    if (!skillNames.has(skill) && !skillNames.has(`principle-${skill}`)) report(file, `names the missing skill \`${skill}\``);
  }
  for (const [, skill] of text.matchAll(/the \*\*([a-z][a-z0-9-]+)\*\* principle skill/g)) {
    if (!skillNames.has(`principle-${skill}`)) report(file, `names the missing principle \`${skill}\``);
  }
}

for (const dir of ["scripts"]) {
  for (const file of walk(join(ROOT, dir))) {
    if (/^(<<<<<<<|>>>>>>>) /m.test(readFileSync(file, "utf8"))) report(file, "has a merge conflict marker");
  }
}

if (problems.length) {
  console.log(`${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`ok: ${skillNames.size} skills, ${files.length} markdown files`);
