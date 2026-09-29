import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { publishEdition, readEditions, readLatest, rebuildIndex } from '../src/archive.mjs';

function sample(id) {
  return { edition: { id, asOf: id.slice(0, 10), generatedAt: '2026-09-29T00:00:00Z', reason: 'Baseline' }, catalog: { entries: [{}] }, collection: { status: 'complete' } };
}
test('editions are append-only, sequential revisions preserve old bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'retirement-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = rows => `<html>${rows.map(row => row.id).join(',')}</html>`;
  await publishEdition(root, sample('2026-09-29'), '<html>first</html>', index);
  const old = await readFile(join(root, 'reports', '2026-09-29', 'report.html'), 'utf8');
  await assert.rejects(publishEdition(root, sample('2026-09-29'), 'overwrite', index), /already exists/);
  await assert.rejects(publishEdition(root, sample('2026-09-29-r3'), 'skip', index), /sequential/);
  await publishEdition(root, sample('2026-09-29-r2'), '<html>correction</html>', index);
  await publishEdition(root, sample('2026-10-05'), '<html>week two</html>', index);
  assert.equal(await readFile(join(root, 'reports', '2026-09-29', 'report.html'), 'utf8'), old);
  assert.equal((await readEditions(root)).length, 3);
  assert.equal((await readLatest(root)).previous.edition.id, '2026-10-05');
  await assert.rejects(publishEdition(root, sample('2026-09-28'), 'backdate', index), /backdated/);
  await rebuildIndex(root, index);
});
test('tampered archives fail before publishing a later edition', async t => {
  const root = await mkdtemp(join(tmpdir(), 'retirement-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await publishEdition(root, sample('2026-09-29'), '<html>first</html>', () => 'index');
  await writeFile(join(root, 'reports', '2026-09-29', 'report.html'), 'tampered');
  await assert.rejects(readEditions(root), /integrity failure/);
  await assert.rejects(publishEdition(root, sample('2026-10-05'), 'next', () => 'index'), /integrity failure/);
});
test('git preserves immutable bytes across platform line-ending settings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'retirement-git-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, '.gitattributes'), await readFile(new URL('../.gitattributes', import.meta.url)));
  await publishEdition(root, sample('2026-09-29'), '<html>\r\nReport\r\n</html>\r\n', () => 'index');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'core.autocrlf', 'true'], { cwd: root });
  execFileSync('git', ['add', '.gitattributes', 'reports'], { cwd: root });
  const staged = execFileSync('git', ['show', ':reports/2026-09-29/report.html'], { cwd: root });
  assert.deepEqual(staged, await readFile(join(root, 'reports', '2026-09-29', 'report.html')));
});
