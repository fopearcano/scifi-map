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
const dataScripts = [...html.matchAll(/<script src="(data\/[^"]+)"/g)].map((m) => m[1]);
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

const links = S.works.reduce((n, w) => n + (w.inf || []).length, 0);
const authors = new Set(S.works.map((w) => w.author)).size;
warnings.forEach((w) => console.warn('warn: ' + w));
if (errors.length) {
  errors.forEach((e) => console.error('error: ' + e));
  console.error(`\n${errors.length} error(s).`);
  process.exit(1);
}
console.log(`OK: ${S.works.length} works, ${authors} authors, ${links} influence links, ${S.sectors.length} sectors, ${(S.tours || []).length} tours.`);
