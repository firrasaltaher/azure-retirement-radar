import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateChanges, htmlEscape } from '../src/model.mjs';
import { renderIndex, renderReport } from '../src/render.mjs';

const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url)));
function fixture() {
  const collection = { status: 'baseline', checkedAt: null, updatesStatus: 'not-run', updatesCount: 0, notices: [], sources: [], errors: ['Live collection not run.'] };
  return { schemaVersion: 1, edition: { id: '2026-09-29', asOf: '2026-09-29', generatedAt: '2026-09-29T20:00:00Z', reason: 'Baseline', previousEditionId: null, generatorVersion: '1.0.0' }, catalog: structuredClone(catalog), collection, changes: calculateChanges(catalog, collection, null) };
}
test('standalone report includes all curated content without needing JavaScript', () => {
  const html = renderReport(fixture());
  const staticHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  for (const entry of catalog.entries) assert.ok(staticHtml.includes(htmlEscape(entry.title)), `Missing ${entry.id}`);
  for (const query of catalog.queries) assert.ok(staticHtml.includes(htmlEscape(query.kql)), `Missing ${query.id}`);
  assert.ok(/not assessed/i.test(html));
  assert.ok(html.includes('--cp-bg:'));
  assert.ok(/@media\s+print/.test(html));
});
test('external strings cannot become executable HTML', () => {
  const snapshot = fixture();
  snapshot.catalog.entries[0].title = '<img src=x onerror="alert(1)">';
  snapshot.edition.reason = '</script><script>bad()</script>';
  const html = renderReport(snapshot);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>bad()'));
  assert.ok(html.includes('&lt;img'));
});
test('report has no external resources, network code or browser persistence', () => {
  const html = renderReport(fixture());
  assert.ok(!/<script[^>]+src\s*=|<link\b|<iframe\b|<object\b|<embed\b/i.test(html));
  assert.ok(!/\bon(?:click|change|load|error)\s*=/i.test(html));
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|document\.cookie|window\.open|\bimport\s*(?:\(|\s)/.test(scripts));
});
test('archive links to exact immutable editions rather than a regenerated latest report', () => {
  const html = renderIndex([
    { id: '2026-09-29', asOf: '2026-09-29', generatedAt: '2026-09-29T20:00:00Z', reason: 'Baseline', status: 'complete', entryCount: 24, sha256: 'abc' },
    { id: '2026-09-29-r2', asOf: '2026-09-29', generatedAt: '2026-09-29T21:00:00Z', reason: 'Correction', status: 'partial', entryCount: 24, sha256: 'def' }
  ]);
  assert.ok(html.includes('reports/2026-09-29/report.html'));
  assert.ok(html.includes('reports/2026-09-29-r2/report.html'));
  assert.ok(html.includes('snapshot.json'));
});
