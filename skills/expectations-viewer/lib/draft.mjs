import { createHash } from 'node:crypto';
import { parse } from '../vendor/pele/pele.js';

const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const CITE = /^\S+:\d+$/;
const OPTION_KEY = /^[A-Z]$/;

export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
export const draftHash = (draft) => sha256(canonicalize(draft));

// Covers what the human read. Tier and chart states can move without asking them again.
export function decisionHash(d) {
  return sha256(canonicalize({ title: d.title, story: d.story, options: d.options, proposed: d.proposed ?? null }));
}

// Maps each state id to its readable label, or '' when the chart gives it none.
// Returns null when Pele cannot parse the chart: the page reports that with the Mermaid text.
export function chartStates(chart) {
  let model;
  try {
    model = parse(chart);
  } catch {
    return null;
  }
  const states = new Map();
  const visitState = (s) => {
    if (!s || s.stmt !== 'state') return;
    if (s.start === undefined) states.set(s.id, states.get(s.id) || s.description || '');
    (s.doc ?? []).forEach(visit);
  };
  const visit = (node) => {
    if (node.stmt === 'relation') {
      visitState(node.state1);
      visitState(node.state2);
    } else {
      visitState(node);
    }
  };
  (model.rootDoc ?? []).forEach(visit);
  return states;
}

export function validateDraft(d) {
  const errors = [];
  const fail = (path, message) => errors.push(`${path}: ${message}`);
  const text = (path, v) => {
    if (typeof v === 'string' && v.trim()) return true;
    fail(path, 'must be text that is not empty');
    return false;
  };
  const list = (path, v) => {
    if (Array.isArray(v)) return true;
    fail(path, 'must be a list');
    return false;
  };
  const textList = (path, v) => {
    if (list(path, v)) v.forEach((item, i) => text(`${path}[${i}]`, item));
  };
  const record = (path, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return true;
    fail(path, 'must be an object');
    return false;
  };
  const uniqueId = (path, id, seen) => {
    if (typeof id !== 'string' || !ID.test(id)) return fail(path, 'must start with a letter and use only letters, digits, - or _');
    if (seen.has(id)) return fail(path, `"${id}" is used twice`);
    seen.add(id);
  };

  if (!record('draft', d)) return errors;

  text('title', d.title);
  text('milestone', d.milestone);

  if (record('context', d.context)) {
    text('context.summary', d.context.summary);
    text('context.today', d.context.today);
    text('context.changes', d.context.changes);
    textList('context.outOfScope', d.context.outOfScope);
  }

  if (text('chart', d.chart) && !/^stateDiagram-v2\s*$/m.test(d.chart.split('\n').find((l) => l.trim() && !l.trim().startsWith('%%')) ?? '')) {
    fail('chart', 'first line must be stateDiagram-v2');
  }

  const decisionIds = new Set();
  if (list('decisions', d.decisions)) d.decisions.forEach((x, i) => {
    const p = `decisions[${i}]`;
    if (!record(p, x)) return;
    uniqueId(`${p}.id`, x.id, decisionIds);
    text(`${p}.title`, x.title);
    text(`${p}.story`, x.story);
    if (x.tier !== 'decide' && x.tier !== 'glance') fail(`${p}.tier`, 'must be decide or glance');
    const keys = new Set();
    if (list(`${p}.options`, x.options)) {
      if (x.options.length < 2) fail(`${p}.options`, 'needs at least two options');
      x.options.forEach((o, j) => {
        const q = `${p}.options[${j}]`;
        if (!record(q, o)) return;
        if (typeof o.key !== 'string' || !OPTION_KEY.test(o.key)) fail(`${q}.key`, 'must be one capital letter');
        else if (keys.has(o.key)) fail(`${q}.key`, `"${o.key}" is used twice`);
        keys.add(o.key);
        text(`${q}.text`, o.text);
      });
    }
    if (x.tier === 'glance' && !keys.has(x.proposed)) fail(`${p}.proposed`, 'glance items must name one of their options');
    if (x.tier === 'decide' && x.proposed !== undefined) fail(`${p}.proposed`, 'only glance items carry a proposal');
    if (list(`${p}.states`, x.states)) x.states.forEach((s, j) => text(`${p}.states[${j}]`, s));
  });

  const ruleIds = new Set();
  if (list('rules', d.rules)) d.rules.forEach((r, i) => {
    const p = `rules[${i}]`;
    if (!record(p, r)) return;
    uniqueId(`${p}.id`, r.id, ruleIds);
    text(`${p}.statement`, r.statement);
    if (!list(`${p}.columns`, r.columns)) return;
    r.columns.forEach((c, j) => text(`${p}.columns[${j}]`, c));
    if (!list(`${p}.rows`, r.rows)) return;
    r.rows.forEach((row, j) => {
      const q = `${p}.rows[${j}]`;
      if (!record(q, row)) return;
      text(`${q}.door`, row.door);
      if (row.cite !== undefined && (typeof row.cite !== 'string' || !CITE.test(row.cite))) fail(`${q}.cite`, 'must look like file:line');
      if (!list(`${q}.cells`, row.cells)) return;
      if (row.cells.length !== r.columns.length) fail(`${q}.cells`, `has ${row.cells.length} cells for ${r.columns.length} columns`);
      row.cells.forEach((cell, k) => {
        const c = `${q}.cells[${k}]`;
        if (typeof cell === 'string') return void text(c, cell);
        if (!record(c, cell)) return;
        if (!decisionIds.has(cell.decision)) fail(`${c}.decision`, `no decision with id "${cell.decision}"`);
      });
    });
  });

  if (list('journeys', d.journeys)) d.journeys.forEach((j, i) => {
    const p = `journeys[${i}]`;
    if (!record(p, j)) return;
    text(`${p}.name`, j.name);
    text(`${p}.who`, j.who);
    text(`${p}.startsFrom`, j.startsFrom);
    text(`${p}.wants`, j.wants);
    if (list(`${p}.steps`, j.steps)) j.steps.forEach((s, k) => {
      const q = `${p}.steps[${k}]`;
      if (!record(q, s)) return;
      text(`${q}.name`, s.name);
      textList(`${q}.lines`, s.lines);
      if (list(`${q}.failures`, s.failures)) s.failures.forEach((f, m) => {
        if (!record(`${q}.failures[${m}]`, f)) return;
        text(`${q}.failures[${m}].when`, f.when);
        text(`${q}.failures[${m}].then`, f.then);
      });
    });
    if (Array.isArray(j.steps) && !j.steps.some((s) => Array.isArray(s?.failures) && s.failures.length > 0)) {
      fail(`${p}.steps`, 'needs at least one bad case in a step\'s failures');
    }
    if (list(`${p}.holds`, j.holds)) j.holds.forEach((h, k) => {
      const q = `${p}.holds[${k}]`;
      if (!record(q, h)) return;
      text(`${q}.text`, h.text);
      if (h.rule !== undefined && !ruleIds.has(h.rule)) fail(`${q}.rule`, `no rule with id "${h.rule}"`);
    });
  });

  textList('lowStakes', d.lowStakes);

  if (typeof d.chart === 'string' && Array.isArray(d.decisions)) {
    const known = chartStates(d.chart);
    if (known) d.decisions.forEach((x, i) => {
      if (!Array.isArray(x?.states)) return;
      x.states.forEach((s, j) => {
        if (typeof s === 'string' && !known.has(s)) fail(`decisions[${i}].states[${j}]`, `chart has no state "${s}"`);
      });
    });
  }

  return errors;
}

export function parseDraft(raw) {
  let draft;
  try {
    draft = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (e) {
    return { ok: false, title: 'draft.json is not valid JSON', details: [e.message] };
  }
  const details = validateDraft(draft);
  if (details.length) return { ok: false, title: `draft.json has ${details.length} problem${details.length === 1 ? '' : 's'}`, details };
  return { ok: true, draft, hash: draftHash(draft) };
}
