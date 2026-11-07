#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "sync/upstreams.json");
const CACHE = join(ROOT, ".sync-cache");

const [command = "status", ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const only = flag("--only");
const toRef = flag("--to");
const asJson = args.includes("--json");

const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "buffer", maxBuffer: 1 << 28 });
const gitText = (cwd, ...a) => git(cwd, ...a).toString("utf8").trim();

const ensureClone = (name, up) => {
  const dir = join(CACHE, name);
  if (existsSync(dir) && spawnSync("git", ["config", "remote.origin.promisor"], { cwd: dir }).status === 0) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (!existsSync(dir)) {
    mkdirSync(CACHE, { recursive: true });
    execFileSync("git", ["clone", "-q", "--no-checkout", up.repo, dir]);
  }
  git(dir, "fetch", "-q", "origin", up.branch);
  return dir;
};

const upstreamPath = (up, p) => (up.root ? `${up.root}/${p}` : p);

const changedFiles = (dir, oldRef, newRef, path) => {
  const out = gitText(dir, "diff", "--name-only", oldRef, newRef, "--", path);
  return out === "" ? [] : out.split("\n");
};

const show = (dir, ref, path) => {
  const r = spawnSync("git", ["show", `${ref}:${path}`], { cwd: dir, maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout : null;
};

const isBinary = (buf) => buf !== null && buf.includes(0);

const rewrite = (up, buf) => {
  if (buf === null || isBinary(buf)) return buf;
  let s = buf.toString("utf8");
  for (const r of up.rewrites ?? []) {
    s = r.pattern ? s.replace(new RegExp(r.pattern, "g"), r.replace) : s.split(r.from).join(r.to);
  }
  return Buffer.from(s, "utf8");
};

const same = (a, b) => (a === null ? b === null : b !== null && a.equals(b));

const merge3 = (ours, base, theirs) => {
  const tmp = mkdtempSync(join(tmpdir(), "nnn-sync-"));
  const [o, b, t] = ["ours", "base", "theirs"].map((n) => join(tmp, n));
  writeFileSync(o, ours);
  writeFileSync(b, base ?? Buffer.alloc(0));
  writeFileSync(t, theirs);
  const r = spawnSync("git", ["merge-file", "-p", "-L", "ours", "-L", "base", "-L", "upstream", o, b, t], {
    maxBuffer: 1 << 28,
  });
  rmSync(tmp, { recursive: true, force: true });
  return { content: r.stdout, conflicts: r.status };
};

const mapLocal = (up, file) => {
  for (const [from, to] of Object.entries(up.map)) {
    const src = upstreamPath(up, from);
    if (file === src || file.startsWith(`${src}/`)) return join(ROOT, to, relative(src, file));
  }
  return undefined;
};


const walkFiles = (dir) =>
  !existsSync(dir)
    ? []
    : readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walkFiles(join(dir, e.name)) : e.name === ".DS_Store" ? [] : [join(dir, e.name)]
      );

const planCopy = (name, up) => {
  const r = { name, type: "copy", source: up.path, files: [], newSkills: [] };
  for (const [from, to] of Object.entries(up.map)) {
    const src = join(up.path, from);
    const dst = join(ROOT, to);
    const rels = new Set([...walkFiles(src).map((f) => relative(src, f)), ...walkFiles(dst).map((f) => relative(dst, f))]);
    for (const rel of rels) {
      const a = existsSync(join(src, rel)) ? readFileSync(join(src, rel)) : null;
      const b = existsSync(join(dst, rel)) ? readFileSync(join(dst, rel)) : null;
      if (same(a, b)) continue;
      r.files.push({ local: relative(ROOT, join(dst, rel)), action: a === null ? "delete" : b === null ? "add" : "update", theirs: a });
    }
  }
  r.watchHashes = {};
  r.watched = [];
  for (const w of up.watch ?? []) {
    const h = createHash("sha256");
    for (const f of walkFiles(join(up.path, w)).sort()) h.update(relative(up.path, f)).update(readFileSync(f));
    r.watchHashes[w] = h.digest("hex").slice(0, 12);
    if (up.watchHashes?.[w] !== r.watchHashes[w]) r.watched.push(w);
  }
  const known = new Set([...Object.keys(up.map), ...(up.ignore?.skills ?? [])]);
  for (const e of readdirSync(up.path, { withFileTypes: true })) {
    if (e.isDirectory() && !known.has(e.name)) r.newSkills.push(e.name);
  }
  return r;
};

const plan = (name, up) => {
  const dir = ensureClone(name, up);
  const oldRef = up.ref;
  const newRef = gitText(dir, "rev-parse", toRef ?? `origin/${up.branch}`);
  const root = up.root || ".";
  const r = {
    name,
    cache: relative(ROOT, dir),
    oldRef,
    newRef,
    commits: [],
    files: [],
    newSkills: [],
    ignoredChanged: [],
    watched: [],
  };
  if (oldRef === newRef) return r;

  const log = gitText(dir, "log", "--format=%h %ad %s", "--date=short", `${oldRef}..${newRef}`, "--", root);
  r.commits = log === "" ? [] : log.split("\n");

  const skillsDir = upstreamPath(up, "skills");
  const mappedSkills = new Set(
    Object.keys(up.map)
      .filter((k) => k.startsWith("skills/"))
      .map((k) => k.split("/")[1])
  );
  const ignored = new Set(up.ignore?.skills ?? []);
  const watch = (up.watch ?? []).map((w) => upstreamPath(up, w));

  for (const file of changedFiles(dir, oldRef, newRef, root)) {
    const local = mapLocal(up, file);
    if (local) {
      const base = rewrite(up, show(dir, oldRef, file));
      const theirs = rewrite(up, show(dir, newRef, file));
      const ours = existsSync(local) ? readFileSync(local) : null;
      let action;
      if (same(base, theirs)) continue;
      else if (ours === null && base !== null) action = "skip-deleted-here";
      else if (ours === null) action = "add";
      else if (same(ours, theirs)) action = "already-same";
      else if (same(ours, base)) action = theirs === null ? "delete" : "update";
      else if (theirs === null) action = "conflict-deleted-upstream";
      else if (isBinary(ours) || isBinary(theirs)) action = "conflict-binary";
      else action = "merge";
      r.files.push({ upstream: file, local: relative(ROOT, local), action, base, theirs, ours });
      continue;
    }
    if (file.startsWith(`${skillsDir}/`)) {
      const skill = relative(skillsDir, file).split("/")[0];
      const bucket = ignored.has(skill) ? r.ignoredChanged : mappedSkills.has(skill) ? null : r.newSkills;
      if (bucket && !bucket.includes(skill)) bucket.push(skill);
      if (bucket) continue;
    }
    if (watch.some((w) => file === w || file.startsWith(`${w}/`) || new RegExp(`^${w.replace(/\*/g, "[^/]*")}$`).test(file))) {
      r.watched.push(file);
    }
  }
  return r;
};

const apply = (r) => {
  for (const f of r.files) {
    const local = join(ROOT, f.local);
    const write = (buf) => {
      if (buf === null) rmSync(local, { force: true });
      else {
        mkdirSync(dirname(local), { recursive: true });
        writeFileSync(local, buf);
      }
    };
    if (f.action === "add" || f.action === "update" || f.action === "delete") write(f.theirs);
    if (f.action === "merge") {
      const { content, conflicts } = merge3(f.ours, f.base, f.theirs);
      write(content);
      if (conflicts !== 0) f.action = `conflict-${conflicts}`;
    }
  }
};

const print = (r) => {
  if (r.type === "copy") {
    console.log(`\n${r.name}: copy from ${r.source}`);
    if (!r.files.length && !r.newSkills.length && !r.watched.length) return console.log("  up to date");
    if (r.watched.length) console.log(`  watched, changed since last apply (port by hand):\n    ${r.watched.join("\n    ")}`);
    for (const [action, fs] of Object.entries(Object.groupBy(r.files, (f) => f.action))) {
      console.log(`  ${action} (${fs.length}):\n    ${fs.map((f) => f.local).join("\n    ")}`);
    }
    if (r.newSkills.length) console.log(`  new skills there, not mapped or ignored:\n    ${r.newSkills.join("\n    ")}`);
    return;
  }
  console.log(`\n${r.name}: ${r.oldRef.slice(0, 7)} -> ${r.newRef.slice(0, 7)}  (cache: ${r.cache})`);
  if (r.oldRef === r.newRef) return console.log("  up to date");
  console.log(`  commits (${r.commits.length}):\n    ${r.commits.slice(0, 40).join("\n    ")}${r.commits.length > 40 ? "\n    ..." : ""}`);
  const byAction = Object.groupBy(r.files, (f) => f.action);
  const same = byAction["already-same"]?.length ?? 0;
  delete byAction["already-same"];
  if (same) console.log(`  already-same (${same}): upstream caught up with local edits, nothing to do`);
  for (const [action, fs] of Object.entries(byAction)) {
    console.log(`  ${action} (${fs.length}):\n    ${fs.map((f) => f.local).join("\n    ")}`);
  }
  if (r.newSkills.length) console.log(`  new upstream skills, not mapped or ignored:\n    ${r.newSkills.join("\n    ")}`);
  if (r.ignoredChanged.length) console.log(`  ignored skills that changed:\n    ${r.ignoredChanged.join("\n    ")}`);
  if (r.watched.length) console.log(`  watched files that changed (port by hand if they matter):\n    ${r.watched.join("\n    ")}`);
};

if (!["status", "apply", "diff"].includes(command)) {
  console.error("usage: sync.mjs status|apply [--only <upstream>] [--to <ref>] [--json]\n       sync.mjs diff <upstream> <upstream-path> [--to <ref>]");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

if (command === "diff") {
  const [name, path] = args.filter((a) => !a.startsWith("--") && a !== toRef);
  const up = manifest[name];
  if (!up || !path) {
    console.error("usage: sync.mjs diff <upstream> <upstream-path>, for example: diff pstack skills/how");
    process.exit(2);
  }
  const dir = ensureClone(name, up);
  const newRef = gitText(dir, "rev-parse", toRef ?? `origin/${up.branch}`);
  process.stdout.write(git(dir, "diff", up.ref, newRef, "--", upstreamPath(up, path)));
  process.exit(0);
}

const reports = [];
for (const [name, up] of Object.entries(manifest)) {
  if (only && only !== name) continue;
  if (up.type === "copy") {
    if (command === "diff") continue;
    const r = planCopy(name, up);
    if (command === "apply") {
      apply(r);
      manifest[name].watchHashes = r.watchHashes;
      writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    reports.push(r);
    continue;
  }
  let r;
  try {
    r = plan(name, up);
  } catch (e) {
    console.error(`\n${name}: could not reach ${up.repo}. ${String(e.stderr ?? e.message).trim().split("\n")[0]}. Fix: check access to the repo, then rerun.`);
    process.exitCode = 1;
    continue;
  }
  if (command === "apply" && r.oldRef !== r.newRef) {
    apply(r);
    up.ref = r.newRef;
  }
  reports.push(r);
}

if (asJson) {
  const strip = (r) => ({ ...r, files: r.files.map(({ upstream, local, action }) => ({ upstream, local, action })) });
  console.log(JSON.stringify(reports.map(strip), null, 2));
} else reports.forEach(print);

if (command === "apply") {
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  if (reports.some((r) => r.files.some((f) => f.action.startsWith("conflict")))) {
    console.log("\nConflicts left markers or need a decision. Resolve them, then run `npm run check`.");
    process.exit(1);
  }
}
