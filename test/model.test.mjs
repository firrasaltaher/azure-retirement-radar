import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addMonths, assertDate, calculateChanges, classify, daysBetween, EDITION_PATTERN, htmlEscape, noticeInWindow, safeLink, todayEastern, validateCatalog } from '../src/model.mjs';

const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url)));
test('public catalog has resolved references and 24 reviewed milestones', () => {
  assert.equal(validateCatalog(catalog).entries.length, 24);
  const copy = structuredClone(catalog);
  copy.entries[0].customerOwner = 'unsupported field';
  assert.throws(() => validateCatalog(copy), /unexpected field/);
});
test('dates reject impossible calendar values', () => {
  for (const value of ['2026-02-30', '2026-13-01', '09/29/2026', '2026-9-1']) assert.throws(() => assertDate(value));
  assert.equal(assertDate('2028-02-29'), '2028-02-29');
});
test('edition identifiers allow double-digit revisions but not traversal', () => {
  for (const id of ['2026-09-29', '2026-09-29-r2', '2026-09-29-r10', '2026-09-29-r20']) assert.ok(EDITION_PATTERN.test(id));
  for (const id of ['2026-09-29-r1', '2026-09-29-r0', '../2026-09-29', '2026-09-29/r2']) assert.ok(!EDITION_PATTERN.test(id));
});
test('rolling horizons use calendar months and inclusive boundaries', () => {
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28');
  assert.equal(addMonths('2027-11-30', 3), '2028-02-29');
  assert.equal(classify('2026-09-28', '2026-09-29'), 'Past milestone');
  assert.equal(classify('2026-12-29', '2026-09-29'), '0-3 months');
  assert.equal(classify('2026-12-30', '2026-09-29'), '3-6 months');
  assert.equal(classify('2027-03-29', '2026-09-29'), '3-6 months');
  assert.equal(classify('2027-03-30', '2026-09-29'), 'Beyond horizon');
  assert.equal(daysBetween('2026-09-29', '2026-09-30'), 1);
});
test('Eastern dates respect both DST and standard time', () => {
  assert.equal(todayEastern(new Date('2026-09-30T02:00:00Z')), '2026-09-29');
  assert.equal(todayEastern(new Date('2026-12-01T04:00:00Z')), '2026-11-30');
});
test('source URL policy rejects third-party/private locations and active URLs', () => {
  for (const url of ['javascript:alert(1)', 'https://microsoft.sharepoint.com/sites/a', 'https://learn.microsoft.com.evil.test/', 'https://user@learn.microsoft.com/', 'https://localhost/', 'http://learn.microsoft.com/', 'https://learn.microsoft.com:8080/']) assert.throws(() => safeLink(url));
  assert.equal(safeLink('https://learn.microsoft.com/en-us/azure/'), 'https://learn.microsoft.com/en-us/azure/');
  assert.equal(htmlEscape('<img onerror="x">&\''), '&lt;img onerror=&quot;x&quot;&gt;&amp;&#39;');
});
test('undated discovery remains visible, beyond-window notices do not', () => {
  assert.ok(noticeInWindow({ months: [] }, '2026-09-29'));
  assert.ok(noticeInWindow({ months: ['2027-03'] }, '2026-09-29'));
  assert.ok(!noticeInWindow({ months: ['2027-04'] }, '2026-09-29'));
});
test('changes distinguish review/catalog edits from fetched sources', () => {
  const collection = { notices: [{ id: 'n', fingerprint: 'a' }], sources: [{ id: 's', status: 'ok', fingerprint: 'a' }] };
  const previous = { catalog: structuredClone(catalog), collection: structuredClone(collection) };
  const next = structuredClone(catalog);
  next.entries[0].date = '2026-10-01';
  collection.notices[0].fingerprint = 'b';
  collection.sources[0].fingerprint = 'b';
  const changes = calculateChanges(next, collection, previous);
  assert.deepEqual(changes.updatedEntries[0].fields, ['date']);
  assert.equal(changes.updatedEntries[0].previousDate, '2026-09-30');
  assert.deepEqual(changes.changedNoticeIds, ['n']);
  assert.deepEqual(changes.changedSourceIds, ['s']);
  assert.equal(next.entries[0].reviewedOn, '2026-09-29');
});
