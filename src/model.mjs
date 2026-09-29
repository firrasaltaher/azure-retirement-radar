import { createHash } from 'node:crypto';

const officialHosts = new Set(['learn.microsoft.com', 'www.microsoft.com', 'azure.microsoft.com', 'techcommunity.microsoft.com']);
export const GENERATOR_VERSION = '1.0.0';
export const EDITION_PATTERN = /^\d{4}-\d{2}-\d{2}(?:-r(?:[2-9]|[1-9]\d+))?$/;
export const hash = value => createHash('sha256').update(value).digest('hex');
export const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function safeLink(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !officialHosts.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error(`Source URL is not an approved public Microsoft source: ${value}`);
  }
  return value;
}
export function assertDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error(`Invalid date: ${value}`);
  return value;
}
export function todayEastern(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function daysBetween(start, end) {
  return (Date.parse(`${assertDate(end)}T00:00:00Z`) - Date.parse(`${assertDate(start)}T00:00:00Z`)) / 86400000;
}
export function addMonths(value, months) {
  const date = new Date(`${assertDate(value)}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}
export function classify(date, asOf) {
  assertDate(date); assertDate(asOf);
  if (date < asOf) return 'Past milestone';
  if (date <= addMonths(asOf, 3)) return '0-3 months';
  if (date <= addMonths(asOf, 6)) return '3-6 months';
  return 'Beyond horizon';
}
export function noticeInWindow(notice, asOf) {
  return !notice.months.length || notice.months.some(month => month >= asOf.slice(0, 7) && month <= addMonths(asOf, 6).slice(0, 7));
}
function fields(object, allowed, label) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(object)) if (!allowed.includes(key)) throw new Error(`${label}: unexpected field ${key}`);
  for (const key of allowed) if (!(key in object)) throw new Error(`${label}: missing field ${key}`);
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text`);
}
function uniqueRows(rows, label) {
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${label} must be a non-empty array`);
  const ids = new Set();
  for (const row of rows) {
    text(row.id, `${label}.id`);
    if (!/^[a-zA-Z0-9_-]+$/.test(row.id) || ids.has(row.id)) throw new Error(`${label}: invalid or duplicate ID ${row.id}`);
    ids.add(row.id);
  }
  return ids;
}
export function validateCatalog(catalog) {
  fields(catalog, ['schemaVersion', 'title', 'reviewedOn', 'entries', 'conflicts', 'backlog', 'assistance', 'queries', 'sources'], 'catalog');
  if (catalog.schemaVersion !== 1) throw new Error('Unsupported catalog schema');
  text(catalog.title, 'title'); assertDate(catalog.reviewedOn);
  const sourceIds = uniqueRows(catalog.sources, 'sources');
  for (const source of catalog.sources) {
    fields(source, ['id', 'url', 'title'], 'source');
    text(source.title, 'source.title'); safeLink(source.url);
  }
  const assistanceIds = uniqueRows(catalog.assistance, 'assistance');
  const specs = {
    entries: ['id', 'title', 'family', 'date', 'kind', 'consequence', 'action', 'discovery', 'assistanceId', 'sourceIds', 'reviewedOn', 'confidence', 'notes'],
    conflicts: ['id', 'title', 'summary', 'treatment', 'sourceIds'],
    backlog: ['id', 'title', 'date', 'summary', 'sourceIds'],
    assistance: ['id', 'title', 'scope', 'boundary', 'sourceIds'],
    queries: ['id', 'title', 'description', 'kql', 'limitations', 'sourceIds']
  };
  for (const [group, keys] of Object.entries(specs)) {
    uniqueRows(catalog[group], group);
    for (const row of catalog[group]) {
      fields(row, keys, group);
      for (const key of keys.filter(k => k !== 'sourceIds')) text(row[key], `${row.id}.${key}`);
      if (!Array.isArray(row.sourceIds) || !row.sourceIds.length || row.sourceIds.some(id => !sourceIds.has(id))) throw new Error(`Unresolved sources for ${row.id}`);
      if (row.date) assertDate(row.date);
      if (row.reviewedOn) assertDate(row.reviewedOn);
      if (row.assistanceId && !assistanceIds.has(row.assistanceId)) throw new Error(`Unresolved assistance for ${row.id}`);
      if (row.confidence && !['official', 'conflict'].includes(row.confidence)) throw new Error(`Invalid confidence ${row.id}`);
    }
  }
  return catalog;
}
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const semanticHash = value => hash(JSON.stringify(stable(value)));
export function calculateChanges(catalog, collection, previous) {
  const oldEntries = new Map((previous?.catalog.entries ?? []).map(row => [row.id, row]));
  const oldNotices = new Map((previous?.collection.notices ?? []).map(row => [row.id, row]));
  const oldSources = new Map((previous?.collection.sources ?? []).map(row => [row.id, row]));
  return {
    newEntries: catalog.entries.filter(row => !oldEntries.has(row.id)).map(row => row.id),
    updatedEntries: catalog.entries.flatMap(row => {
      const old = oldEntries.get(row.id);
      if (!old) return [];
      const changed = Object.keys(row).filter(key => semanticHash(row[key]) !== semanticHash(old[key]));
      return changed.length ? [{ id: row.id, title: row.title, fields: changed, previousDate: old.date, date: row.date }] : [];
    }),
    removedEntries: (previous?.catalog.entries ?? []).filter(old => !catalog.entries.some(row => row.id === old.id)).map(({ id, title, date }) => ({ id, title, date })),
    newNoticeIds: collection.notices.filter(row => !oldNotices.has(row.id)).map(row => row.id),
    changedNoticeIds: collection.notices.filter(row => oldNotices.has(row.id) && oldNotices.get(row.id).fingerprint !== row.fingerprint).map(row => row.id),
    changedSourceIds: collection.sources.filter(row => row.status === 'ok' && oldSources.get(row.id)?.status === 'ok' && oldSources.get(row.id).fingerprint !== row.fingerprint).map(row => row.id)
  };
}
