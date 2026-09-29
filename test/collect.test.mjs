import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSources, collectUpdates, fetchText, normalizeNotice, sourceFingerprint } from '../src/collect.mjs';

const row = i => ({ id: String(i), title: `Retirement ${i}`, description: 'Official full retirement description for fixture purposes.', products: ['Example'], availabilities: [{ ring: 'Retirement', year: 2027, month: 'March' }], created: '2026-09-01', modified: '2026-09-02' });
test('collector reads all pages, with no RSS recency cutoff', async () => {
  const offsets = [];
  const notices = await collectUpdates(async url => {
    const skip = Number(new URL(url).searchParams.get('$skip')); offsets.push(skip);
    return JSON.stringify({ '@odata.count': 205, value: Array.from({ length: Math.min(100, 205 - skip) }, (_, i) => row(skip + i)) });
  });
  assert.deepEqual(offsets, [0, 100, 200]);
  assert.equal(notices.length, 205);
});
test('pagination count drift, duplicate IDs and incomplete pages fail closed', async () => {
  await assert.rejects(collectUpdates(async () => JSON.stringify({ '@odata.count': 0, value: [] })), /empty retirement catalog/);
  await assert.rejects(collectUpdates(async () => JSON.stringify({ '@odata.count': 5, value: [row(1)] })), /Incomplete/);
  await assert.rejects(collectUpdates(async () => JSON.stringify({ '@odata.count': 2, value: [row(1), row(1)] })), /Duplicate/);
  let call = 0;
  await assert.rejects(collectUpdates(async () => JSON.stringify({ '@odata.count': ++call === 1 ? 101 : 102, value: Array.from({ length: 100 }, (_, i) => row(i)) })), /changed during/);
});
test('metadata is a month, never an invented exact deadline', () => {
  assert.deepEqual(normalizeNotice(row(1)).months, ['2027-03']);
  const missing = row(1); missing.availabilities = [{ ring: 'Retirement', year: 2027, month: 'not-a-month' }];
  assert.deepEqual(normalizeNotice(missing).months, []);
  assert.ok(!('date' in normalizeNotice(row(1))));
});
test('source failures become explicit partial coverage; discovery failure is fatal', async () => {
  const catalog = { sources: [{ id: 'broken', url: 'https://learn.microsoft.com/missing' }] };
  const result = await collectSources(catalog, { now: '2026-09-29T00:00:00Z', read: async url => {
    if (url.includes('$') || url.includes('%24')) return JSON.stringify({ '@odata.count': 1, value: [row(1)] });
    throw new Error('source unavailable');
  } });
  assert.equal(result.status, 'partial');
  assert.equal(result.sources[0].status, 'error');
  assert.equal(result.errors.length, 1);
  await assert.rejects(collectSources(catalog, { read: async () => { throw new Error('catalog outage'); } }), /catalog outage/);
});
test('fingerprints ignore YAML metadata but detect source content changes', () => {
  const body = '# Heading\n' + 'Service lifecycle text. '.repeat(10);
  assert.equal(sourceFingerprint(`---\nupdated: today\n---\n${body}`), sourceFingerprint(`---\nupdated: tomorrow\n---\n${body}`));
  assert.notEqual(sourceFingerprint(body), sourceFingerprint(body + ' Date changed.'));
  assert.throws(() => sourceFingerprint(''), /short/);
});
test('redirects cannot leave official public source hosts', async () => {
  await assert.rejects(fetchText('https://learn.microsoft.com/test', async () => ({ status: 302, headers: new Headers({ location: 'http://localhost/secret' }) })), /approved public/);
});
