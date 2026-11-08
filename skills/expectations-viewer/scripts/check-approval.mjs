#!/usr/bin/env node
// Says whether answers.json approves the current draft.json in a draft folder. With --brief, also checks
// that every EARS line and glossary entry in the brief appears word for word in the approved draft.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDraft } from '../lib/draft.mjs';
import { answersHash, parseAnswers } from '../lib/answers.mjs';

export function checkApproval(dir) {
  const draftFile = join(dir, 'draft.json');
  const answersFile = join(dir, 'answers.json');
  if (!existsSync(draftFile)) return { ok: false, message: `no draft.json in ${dir}` };
  const draft = parseDraft(readFileSync(draftFile, 'utf8'));
  if (!draft.ok) return { ok: false, message: draft.title };
  if (!existsSync(answersFile)) return { ok: false, message: 'no answers.json yet, so nothing is approved' };
  const answers = parseAnswers(readFileSync(answersFile, 'utf8'));
  if (!answers.ok) return { ok: false, message: answers.message };
  const approval = answers.answers.approval;
  if (!approval) return { ok: false, message: 'the draft is not approved' };
  if (approval.draftSha256 !== draft.hash) return { ok: false, message: 'the approval is for an older draft. Ask the human to approve again' };
  if (approval.answersSha256 !== answersHash(answers.answers)) return { ok: false, message: 'the answers changed after approval. Ask the human to approve again' };
  return { ok: true, message: `approved: draft ${draft.hash}` };
}

const EARS = /^(WHEN|WHILE|IF|WHERE|THE)\b/;

function draftStrings(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) for (const each of value) draftStrings(each, found);
  else if (value && typeof value === 'object') for (const each of Object.values(value)) draftStrings(each, found);
  return found;
}

// Brief lines the human has to have seen: EARS lines anywhere, and glossary entries.
export function briefLines(text) {
  const lines = [];
  let section = '';
  for (const raw of text.split('\n')) {
    const heading = /^## (.+)$/.exec(raw);
    if (heading) section = heading[1].trim();
    const item = /^- (.+)$/.exec(raw.trim());
    if (!item) continue;
    const body = item[1].replace(/^Replace [A-Z][A-Z0-9]*-\d+: /, '').trim();
    if (EARS.test(body) || (section === 'Glossary' && body !== 'None.')) lines.push(body);
  }
  return [...new Set(lines)];
}

export function unseenLines(dir, briefFile) {
  const draft = JSON.parse(readFileSync(join(dir, 'draft.json'), 'utf8'));
  const strings = draftStrings(draft);
  return briefLines(readFileSync(briefFile, 'utf8')).filter((line) => !strings.some((each) => each.includes(line)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, flag, briefFile] = process.argv.slice(2);
  if (!dir || (flag !== undefined && (flag !== '--brief' || !briefFile))) {
    console.error('usage: node scripts/check-approval.mjs <draft-dir> [--brief <brief.md>]');
    process.exit(2);
  }
  const result = checkApproval(dir);
  console.log(`check-approval: ${result.message}`);
  if (!result.ok) process.exit(1);
  if (briefFile) {
    const unseen = unseenLines(dir, briefFile);
    for (const line of unseen) console.log(`check-approval: not in the approved draft: ${line}`);
    if (unseen.length > 0) {
      console.log('check-approval: the human never saw these words. Put them in the draft and ask for approval again');
      process.exit(1);
    }
    console.log('check-approval: every brief line is in the approved draft');
  }
}
