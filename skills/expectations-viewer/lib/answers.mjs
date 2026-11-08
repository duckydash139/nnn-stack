import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { canonicalize, chartStates, decisionHash, draftHash, sha256 } from './draft.mjs';

const own = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : undefined);

export const emptyAnswers = () => ({ decisions: {}, notes: {}, approval: null });

export function parseAnswers(raw) {
  let answers;
  try {
    answers = JSON.parse(raw);
  } catch (e) {
    return { ok: false, message: `answers.json is not valid JSON: ${e.message}` };
  }
  if (!answers || typeof answers !== 'object' || typeof answers.decisions !== 'object' || !answers.decisions) {
    return { ok: false, message: 'answers.json has no decisions object' };
  }
  const notes = answers.notes ?? {};
  if (typeof notes !== 'object' || Array.isArray(notes)) return { ok: false, message: 'answers.json has a notes value that is not an object' };
  return { ok: true, answers: { decisions: answers.decisions, notes, approval: answers.approval ?? null } };
}

export function writeAtomic(file, text) {
  const tmp = join(dirname(file), `.answers.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    const fd = openSync(tmp, 'wx', 0o644);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export const serializeAnswers = (answers) => `${JSON.stringify(answers, null, 2)}\n`;

// Timestamps are left out so re-saving the same pick does not stale an approval.
export function answersHash(answers) {
  const picks = {};
  for (const [id, a] of Object.entries(answers.decisions)) {
    picks[id] = { pick: a.pick ?? null, note: a.note ?? '', decisionSha256: a.decisionSha256 ?? null };
  }
  const notes = Object.fromEntries(Object.entries(answers.notes ?? {}).map(([target, n]) => [target, n.note]));
  // With no place notes the hash stays as it always was, so older approvals stay current.
  return sha256(canonicalize(Object.keys(notes).length ? { picks, notes } : picks));
}

// Everything a human can leave a place note on. Targets use names, not row numbers, so a note
// follows its door when rows move. A repeated door in one rule gets a #2, #3 suffix.
export function placeList(draft, notes = {}) {
  if (!draft) return [];
  // The page never shows a raw state id, so a state with no label can't take a note.
  const states = [...(chartStates(draft.chart) ?? [])].filter(([, label]) => label).map(([id, label]) => ({ target: `state:${id}`, state: id, label }));
  const doors = draft.rules.flatMap((rule) => {
    const seen = new Map();
    return rule.rows.map((row, index) => {
      const count = (seen.get(row.door) ?? 0) + 1;
      seen.set(row.door, count);
      return { target: `row:${rule.id}:${row.door}${count > 1 ? `#${count}` : ''}`, rule: rule.id, row: index, label: row.door };
    });
  });
  return [...states, ...doors].map((place, index) => ({ ...place, index, note: own(notes, place.target)?.note ?? '' }));
}

// An empty note removes the entry, so clearing a note undoes it completely.
export function applyPlaceNote(answers, target, note, now) {
  const { [target]: _, ...rest } = answers.notes ?? {};
  return { ...answers, notes: note.trim() ? { ...rest, [target]: { note, at: now.toISOString() } } : rest };
}

// A note alone never re-confirms a pick, so typing one cannot clear a "check again" flag.
export function applyAnswer(answers, decision, { pick, note }, now) {
  const prior = own(answers.decisions, decision.id);
  const next = { pick: prior?.pick ?? null, note: prior?.note ?? '', decisionSha256: prior?.decisionSha256 ?? null };
  if (pick !== undefined) {
    next.pick = pick;
    next.decisionSha256 = decisionHash(decision);
  }
  if (note !== undefined) next.note = note;
  next.at = now.toISOString();
  return { ...answers, decisions: { ...answers.decisions, [decision.id]: next } };
}

export function applyApproval(answers, draft, now) {
  return { ...answers, approval: { draftSha256: draftHash(draft), answersSha256: answersHash(answers), at: now.toISOString() } };
}

function decisionStatus(decision, answer) {
  if (!answer?.pick) return 'open';
  const stillOffered = decision.options.some((o) => o.key === answer.pick);
  return stillOffered && answer.decisionSha256 === decisionHash(decision) ? 'answered' : 'recheck';
}

function approvalStatus(approval, draft, live, answers) {
  if (!approval) return { status: 'none', reasons: [] };
  const reasons = [];
  if (!live || !draft || approval.draftSha256 !== draftHash(draft)) reasons.push('draft');
  if (approval.answersSha256 !== answersHash(answers)) reasons.push('answers');
  return { status: reasons.length ? 'stale' : 'current', reasons, at: approval.at };
}

// draft is the last good draft, which may be older than the file when live is false.
export function deriveState({ draft, live, problem, answers, answersProblem, dir }) {
  const list = draft?.decisions ?? [];
  const states = draft ? chartStates(draft.chart) : null;
  const decisions = list
    .map((d, index) => {
      const answer = own(answers.decisions, d.id) ?? null;
      const stateLabels = d.states.map((id) => states?.get(id)).filter(Boolean);
      return { ...d, stateLabels, answer, sha256: decisionHash(d), status: decisionStatus(d, answer), index };
    })
    .sort((a, b) => (a.tier === b.tier ? a.index - b.index : a.tier === 'decide' ? -1 : 1));

  const decided = decisions.filter((d) => d.status === 'answered').length;
  const decideLeft = decisions.filter((d) => d.tier === 'decide' && d.status !== 'answered').length;
  const recheck = decisions.filter((d) => d.status === 'recheck').length;

  const blockers = [];
  if (!live) blockers.push('The draft file has a problem.');
  if (answersProblem) blockers.push('answers.json cannot be read.');
  if (decideLeft) blockers.push(`${decideLeft} decision${decideLeft === 1 ? '' : 's'} left.`);
  const glanceRecheck = decisions.filter((d) => d.tier === 'glance' && d.status === 'recheck').length;
  if (glanceRecheck) blockers.push(`${glanceRecheck} glance answer${glanceRecheck === 1 ? '' : 's'} to check again.`);

  const known = new Set(list.map((d) => d.id));
  const orphans = Object.keys(answers.decisions).filter((id) => !known.has(id));

  const places = placeList(draft, answers.notes);
  const placed = new Set(places.map((p) => p.target));
  const orphanNotes = Object.keys(answers.notes ?? {}).filter((target) => !placed.has(target));

  const approval = approvalStatus(answers.approval, draft, live, answers);

  // First match wins, so a state jumps to the decision that needs the human most.
  const marks = new Map();
  const needsHuman = approval.status !== 'current';
  for (const d of [...decisions].sort((a, b) => Number(a.status === 'answered') - Number(b.status === 'answered'))) {
    for (const state of d.states) {
      const undecided = needsHuman && d.status !== 'answered';
      if (!marks.has(state)) marks.set(state, { state, decision: d.id, title: d.title, undecided });
    }
  }

  return {
    dir,
    draft,
    live,
    problem: problem ?? null,
    answersProblem: answersProblem ?? null,
    hash: draft ? draftHash(draft) : null,
    decisions,
    marks: [...marks.values()],
    progress: { decided, total: decisions.length, decideLeft, recheck },
    approval,
    canApprove: blockers.length === 0,
    blockers,
    orphans,
    places,
    orphanNotes,
  };
}
