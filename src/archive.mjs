import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EDITION_PATTERN, hash } from './model.mjs';

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
export async function readEditions(root) {
  let files;
  try { files = await readdir(join(root, 'reports'), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const editions = [];
  for (const file of files) {
    if (!file.isDirectory() || !EDITION_PATTERN.test(file.name)) throw new Error(`Unexpected entry in reports archive: ${file.name}`);
    const dir = join(root, 'reports', file.name);
    const manifest = await readJson(join(dir, 'manifest.json'));
    if (manifest.id !== file.name || !manifest.files || Object.keys(manifest.files).sort().join(',') !== 'report.html,snapshot.json') throw new Error(`Invalid manifest: ${file.name}`);
    for (const name of ['report.html', 'snapshot.json']) {
      if (hash(await readFile(join(dir, name))) !== manifest.files[name]) throw new Error(`Immutable edition integrity failure: ${file.name}/${name}`);
    }
    const snapshot = await readJson(join(dir, 'snapshot.json'));
    if (snapshot.edition.id !== file.name || snapshot.edition.asOf !== file.name.slice(0, 10)) throw new Error(`Edition metadata mismatch: ${file.name}`);
    editions.push({ id: file.name, asOf: snapshot.edition.asOf, generatedAt: snapshot.edition.generatedAt, reason: snapshot.edition.reason, status: snapshot.collection.status, entryCount: snapshot.catalog.entries.length, sha256: manifest.files['snapshot.json'] });
  }
  return editions.sort((a, b) => a.asOf.localeCompare(b.asOf) || revision(a.id) - revision(b.id));
}
export const revision = id => Number(id.match(/-r(\d+)$/)?.[1] ?? 1);
export async function readLatest(root) {
  const editions = await readEditions(root);
  const latest = editions.at(-1);
  return { editions, previous: latest ? await readJson(join(root, 'reports', latest.id, 'snapshot.json')) : null };
}
export async function publishEdition(root, snapshot, html, renderIndex) {
  const { id, asOf } = snapshot.edition;
  if (!EDITION_PATTERN.test(id) || id.slice(0, 10) !== asOf) throw new Error('Invalid edition ID');
  const existing = await readEditions(root);
  if (existing.some(row => row.id === id)) throw new Error(`Edition ${id} already exists; never overwritten. Use an explicit revision and reason.`);
  if (existing.at(-1)?.asOf > asOf) throw new Error('Cannot insert a backdated edition behind the latest snapshot');
  const sameDay = existing.filter(row => row.asOf === asOf);
  if (revision(id) !== (sameDay.length ? Math.max(...sameDay.map(row => revision(row.id))) + 1 : 1)) throw new Error('Edition revision must be the next sequential revision');
  const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
  const manifest = { schemaVersion: 1, id, files: { 'snapshot.json': hash(snapshotText), 'report.html': hash(html) } };
  const stage = join(root, `.staging-${id}-${randomUUID()}`);
  await mkdir(stage);
  try {
    await writeFile(join(stage, 'snapshot.json'), snapshotText, { flag: 'wx' });
    await writeFile(join(stage, 'report.html'), html, { flag: 'wx' });
    await writeFile(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await mkdir(join(root, 'reports'), { recursive: true });
    // Reserve the destination exclusively before moving immutable files into it.
    const destination = join(root, 'reports', id);
    await mkdir(destination);
    try {
      for (const file of ['snapshot.json', 'report.html', 'manifest.json']) await rename(join(stage, file), join(destination, file));
    } catch (error) {
      throw new Error(`Edition reservation ${id} is incomplete; inspect before retrying. ${error.message}`);
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  await rebuildIndex(root, renderIndex);
  return manifest;
}
export async function rebuildIndex(root, renderIndex) {
  const editions = await readEditions(root);
  const temporary = join(root, `.staging-index-${randomUUID()}`);
  await writeFile(temporary, renderIndex(editions), { flag: 'wx' });
  await rename(temporary, join(root, 'index.html'));
  await writeFile(join(root, 'latest.json'), `${JSON.stringify({ edition: editions.at(-1)?.id ?? null }, null, 2)}\n`);
  return editions;
}
