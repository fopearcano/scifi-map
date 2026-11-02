#!/usr/bin/env node
/*
 * Checks the dataset for mistakes that would break or mislead the chart:
 * duplicate ids, unknown sectors or awards, influence links that point at
 * missing works or at works published later, and tour steps that do not exist.
 *
 *   node scripts/validate-data.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Load the data scripts in the same order as index.html does.
const dataScripts = [...html.matchAll(/<script src="(data\/[^"?]+)/g)].map((m) => m[1]);
const sandbox = { window: {} };
sandbox.SFMAP = undefined;
vm.createContext(sandbox);
for (const file of dataScripts) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  sandbox.SFMAP = sandbox.window.SFMAP;
}

const S = sandbox.window.SFMAP;
const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);

const sectorIds = new Set(S.sectors.map((s) => s.id));
const awardIds = new Set(Object.keys(S.awardNames));
const forms = new Set(['novel', 'novella', 'novelette', 'short story', 'collection', 'fix-up', 'anthology', 'play']);
const byId = new Map();

// Every sector file listed in data/sectors must be loaded by index.html.
for (const f of fs.readdirSync(path.join(root, 'data/sectors'))) {
  if (!dataScripts.includes(`data/sectors/${f}`)) fail(`data/sectors/${f} is not loaded by index.html`);
}

for (const w of S.works) {
  const where = `work "${w.id}"`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(w.id || '')) fail(`${where}: id must be lowercase letters, digits and hyphens`);
  if (byId.has(w.id)) fail(`${where}: duplicate id`);
  byId.set(w.id, w);
  for (const k of ['title', 'author', 'blurb']) {
    if (typeof w[k] !== 'string' || !w[k].trim()) fail(`${where}: missing ${k}`);
  }
  if (!Number.isInteger(w.year) || w.year < 1 || w.year > new Date().getFullYear()) fail(`${where}: bad year ${w.year}`);
  if (!sectorIds.has(w.sector)) fail(`${where}: unknown sector ${w.sector}`);
  if (w.form && !forms.has(w.form)) fail(`${where}: unknown form "${w.form}"`);
  for (const a of w.awards || []) if (!awardIds.has(a)) fail(`${where}: unknown award "${a}"`);
  if (w.blurb && w.blurb.length > 320) warnings.push(`${where}: blurb is ${w.blurb.length} chars (aim for under 320)`);
}

for (const w of S.works) {
  for (const src of w.inf || []) {
    const from = byId.get(src);
    if (!from) { fail(`work "${w.id}": influence "${src}" does not exist`); continue; }
    if (src === w.id) fail(`work "${w.id}": influences itself`);
    if (from.year > w.year) fail(`work "${w.id}" (${w.year}) lists a later work "${src}" (${from.year}) as an influence`);
  }
}

const tourIds = new Set();
for (const t of S.tours || []) {
  if (tourIds.has(t.id)) fail(`tour "${t.id}": duplicate id`);
  tourIds.add(t.id);
  for (const step of t.steps) if (!byId.has(step.id)) fail(`tour "${t.id}": unknown work "${step.id}"`);
}

// Field guide entries must point at real works, sectors and science fields.
const guide = S.guide || {};
const fields = new Set(guide.fields || []);
for (const section of ['themes', 'science', 'craft']) {
  const entries = guide[section];
  if (!Array.isArray(entries) || !entries.length) { fail(`guide: missing section "${section}"`); continue; }
  const seen = new Set();
  for (const e of entries) {
    const where = `guide ${section} "${e.id}"`;
    if (seen.has(e.id)) fail(`${where}: duplicate id`);
    seen.add(e.id);
    if (!e.name || !Array.isArray(e.works) || !e.works.length) fail(`${where}: needs a name and at least one work`);
    for (const id of e.works || []) if (!byId.has(id)) fail(`${where}: unknown work "${id}"`);
    if (new Set(e.works).size !== (e.works || []).length) fail(`${where}: lists a work twice`);
    if (section === 'themes' && !sectorIds.has(e.sector)) fail(`${where}: unknown sector "${e.sector}"`);
    if (section === 'science' && (!fields.has(e.field) || !e.fact || !e.fact.value)) fail(`${where}: needs a known field and a fact`);
    if (section === 'craft' && (!e.example || !byId.has(e.example.id))) fail(`${where}: example must name a work in the atlas`);
  }
}

// Book titles in guide text are marked *like this*, so markers must pair up.
const checkMarks = (value, where) => {
  if (typeof value === 'string') {
    if ((value.match(/\*/g) || []).length % 2) fail(`${where}: unpaired * title marker`);
  } else if (Array.isArray(value)) {
    value.forEach((v) => checkMarks(v, where));
  } else if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) if (k !== 'works') checkMarks(value[k], where);
  }
};
for (const section of ['themes', 'science', 'craft']) {
  for (const e of guide[section] || []) checkMarks(e, `guide ${section} "${e.id}"`);
}

const links = S.works.reduce((n, w) => n + (w.inf || []).length, 0);
const authors = new Set(S.works.map((w) => w.author)).size;
warnings.forEach((w) => console.warn('warn: ' + w));
if (errors.length) {
  errors.forEach((e) => console.error('error: ' + e));
  console.error(`\n${errors.length} error(s).`);
  process.exit(1);
}
const guideCount = ['themes', 'science', 'craft'].map((k) => `${(guide[k] || []).length} ${k}`).join(', ');
console.log(`OK: ${S.works.length} works, ${authors} authors, ${links} influence links, ${S.sectors.length} sectors, ${(S.tours || []).length} tours; guide: ${guideCount}.`);
