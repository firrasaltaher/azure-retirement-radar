import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { assertDate, calculateChanges, GENERATOR_VERSION, todayEastern, validateCatalog } from './model.mjs';
import { collectSources } from './collect.mjs';
import { publishEdition, readEditions, readLatest, rebuildIndex } from './archive.mjs';
import { renderIndex, renderReport } from './render.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [command = 'validate', ...args] = process.argv.slice(2);
function options(values) {
  const result = {};
  for (let i = 0; i < values.length; i += 2) {
    if (!['--date', '--revision', '--reason', '--mode'].includes(values[i]) || !values[i + 1] || values[i + 1].startsWith('--') || result[values[i]]) throw new Error(`Invalid/duplicate argument ${values[i]}`);
    result[values[i]] = values[i + 1];
  }
  return result;
}
try {
  const opts = options(args);
  const catalog = validateCatalog(JSON.parse(await readFile(join(root, 'data', 'catalog.json'), 'utf8')));
  if (command === 'validate') {
    console.log(`Catalog valid: ${catalog.entries.length} milestones, ${catalog.sources.length} official sources.`);
  } else if (command === 'verify') {
    const editions = await readEditions(root);
    console.log(`Archive valid: ${editions.length} immutable editions.`);
  } else if (command === 'index') {
    console.log(`Index rebuilt for ${(await rebuildIndex(root, renderIndex)).length} editions.`);
  } else if (command === 'report') {
    const asOf = assertDate(opts['--date'] ?? todayEastern());
    const revision = opts['--revision'] ?? '1';
    if (!/^[1-9]\d*$/.test(revision)) throw new Error('Revision must be a positive integer');
    const id = `${asOf}${revision === '1' ? '' : `-r${revision}`}`;
    const mode = opts['--mode'] ?? 'live';
    if (!['live', 'baseline'].includes(mode)) throw new Error('Mode must be live or baseline');
    if (revision !== '1' && !opts['--reason']) throw new Error('A correction revision requires an explicit reason');
    if (catalog.reviewedOn > asOf || catalog.entries.some(row => row.reviewedOn > asOf)) throw new Error('Cannot publish a review dated after the edition');
    const { editions, previous } = await readLatest(root);
    if (editions.some(row => row.id === id)) throw new Error(`Edition ${id} already exists; use a new date or explicit revision.`);
    const generatedAt = new Date().toISOString();
    const collection = mode === 'live' ? await collectSources(catalog) : {
      status: 'baseline', checkedAt: null, updatesStatus: 'not-run', updatesCount: 0, notices: [], sources: [], errors: ['Live collection was not run for this edition.']
    };
    const snapshot = {
      schemaVersion: 1,
      edition: { id, asOf, generatedAt, reason: opts['--reason'] ?? 'Weekly public-source refresh; deadline changes require review', previousEditionId: previous?.edition.id ?? null, generatorVersion: GENERATOR_VERSION },
      catalog, collection, changes: calculateChanges(catalog, collection, previous)
    };
    await publishEdition(root, snapshot, renderReport(snapshot), renderIndex);
    console.log(JSON.stringify({ edition: id, status: collection.status, milestones: catalog.entries.length, publicNotices: collection.updatesCount, sourceErrors: collection.errors, path: join(root, 'reports', id, 'report.html') }, null, 2));
  } else {
    throw new Error(`Unknown command ${command}; use validate, verify, index or report`);
  }
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
