import { appendFile } from 'node:fs/promises';
import { readLatest } from './archive.mjs';
import { fileURLToPath } from 'node:url';
import { noticeInWindow } from './model.mjs';

const { previous: snapshot } = await readLatest(fileURLToPath(new URL('../', import.meta.url)));
if (!snapshot) throw new Error('No edition exists');
const text = `## Azure Retirement Radar\n\nEdition: **${snapshot.edition.id}**\n\n` +
  `Collection: **${snapshot.collection.status}**. Official tagged notices scanned: ${snapshot.collection.updatesCount}. ` +
  `Notices with a six-month or unknown month: ${snapshot.collection.notices.filter(n => noticeInWindow(n, snapshot.edition.asOf)).length}.\n\n` +
  `Curated milestones: ${snapshot.catalog.entries.length}. Last catalog semantic review: **${snapshot.catalog.reviewedOn}**. ` +
  `Changed source fingerprints: ${snapshot.changes.changedSourceIds.length}. Failed source reads: ${snapshot.collection.errors.length}.\n\n` +
  'Source collection is not deadline validation. New notices and changed sources need review before customer handoff. No customer impact was assessed. No site or report was shared with customers.\n\n' +
  'Download the workflow archive, extract it, and open index.html. The permanent copies are committed under reports/; workflow artifacts expire after 90 days.\n';
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
else console.log(text);
