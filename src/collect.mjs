import { hash, safeLink, semanticHash } from './model.mjs';

export const UPDATES_API = 'https://www.microsoft.com/releasecommunications/api/v2/azure';
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchText(url, fetchImpl = fetch) {
  safeLink(url);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetchImpl(url, { headers: { Accept: 'text/markdown, application/json, text/html;q=0.8', 'User-Agent': 'AzureRetirementRadar/1.0 (public-source reporting)' }, signal: AbortSignal.timeout(30000), redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      let current = response;
      let currentUrl = url;
      for (let redirects = 0; redirects < 5; redirects++) {
        const target = new URL(current.headers.get('location'), currentUrl).href;
        safeLink(target);
        current = await fetchImpl(target, { headers: { Accept: 'text/markdown, application/json, text/html;q=0.8' }, signal: AbortSignal.timeout(30000), redirect: 'manual' });
        currentUrl = target;
        if (![301, 302, 303, 307, 308].includes(current.status)) {
          if (!current.ok) throw new Error(`HTTP ${current.status} reading ${currentUrl}`);
          return current.text();
        }
      }
      throw new Error(`Too many redirects reading ${url}`);
    }
    if (response.ok) return response.text();
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw new Error(`HTTP ${response.status} reading ${url}`);
    await wait(1000 * (attempt + 1));
  }
}

export function normalizeNotice(row) {
  if (typeof row.id !== 'string' || !row.id || typeof row.title !== 'string' || !row.title.trim() ||
      typeof row.description !== 'string' || !Array.isArray(row.products) || row.products.some(p => typeof p !== 'string') ||
      !Array.isArray(row.availabilities) || row.availabilities.some(a => !a || typeof a !== 'object')) throw new Error('Azure Updates returned an unsupported notice shape');
  const dates = row.availabilities.filter(a => a.ring === 'Retirement').map(a => {
    const month = months.indexOf(a.month) + 1;
    return Number.isInteger(a.year) && a.year >= 2000 && a.year <= 2200 && month ? `${a.year}-${String(month).padStart(2, '0')}` : null;
  }).filter(Boolean);
  const quotedId = row.id.replaceAll("'", "''");
  const url = new URL(UPDATES_API);
  url.searchParams.set('$filter', `id eq '${quotedId}'`);
  url.searchParams.set('$select', 'id,title,description,modified');
  return {
    id: row.id, title: row.title.trim(), products: row.products, created: row.created ?? null, modified: row.modified ?? null,
    months: [...new Set(dates)].sort(), sourceUrl: url.href,
    fingerprint: semanticHash({ title: row.title, description: row.description, products: row.products, availabilities: row.availabilities })
  };
}

export async function collectUpdates(read = fetchText) {
  const notices = [];
  const seen = new Set();
  let expected;
  for (let skip = 0; skip < 10000; skip += 100) {
    const url = new URL(UPDATES_API);
    url.searchParams.set('$filter', "tags/any(t:t eq 'Retirements')");
    url.searchParams.set('$select', 'id,title,description,created,modified,availabilities,products');
    url.searchParams.set('$orderby', 'id asc');
    url.searchParams.set('$top', '100');
    url.searchParams.set('$skip', String(skip));
    url.searchParams.set('$count', 'true');
    const page = JSON.parse(await read(url.href));
    if (!Array.isArray(page.value) || !Number.isInteger(page['@odata.count'])) throw new Error('Azure Updates pagination/count schema changed');
    if (page['@odata.count'] <= 0) throw new Error('Azure Updates unexpectedly returned an empty retirement catalog');
    if (expected !== undefined && expected !== page['@odata.count']) throw new Error('Azure Updates changed during pagination; retry collection');
    expected = page['@odata.count'];
    for (const row of page.value) {
      const notice = normalizeNotice(row);
      if (seen.has(notice.id)) throw new Error(`Duplicate notice during pagination: ${notice.id}`);
      seen.add(notice.id); notices.push(notice);
    }
    if (notices.length === expected) return notices;
    if (page.value.length !== 100 || notices.length > expected) throw new Error('Incomplete Azure Updates pagination');
  }
  throw new Error('Azure Updates exceeds the 10,000-notice safety limit; collection is incomplete');
}

export function sourceFingerprint(body) {
  let normalized = body.replace(/\r\n/g, '\n');
  if (normalized.startsWith('---\n')) normalized = normalized.replace(/^---\n[\s\S]*?\n---\n/, '');
  const main = normalized.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main) normalized = main[1];
  normalized = normalized.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/\s+/g, ' ').trim();
  if (normalized.length < 80) throw new Error('Source body is unexpectedly short; not accepted as a successful refresh');
  return hash(normalized);
}

export async function collectSources(catalog, { read = fetchText, now = new Date().toISOString() } = {}) {
  // Discovery failure is fatal: never publish an apparently complete empty catalog.
  const notices = await collectUpdates(read);
  const sources = [];
  const errors = [];
  for (const source of catalog.sources) {
    try {
      const body = await read(source.url);
      if (source.url.startsWith(UPDATES_API)) {
        const record = JSON.parse(body);
        if (!Array.isArray(record.value) || !record.value.length || !record.value[0].description) throw new Error('Official Update record missing');
      }
      sources.push({ id: source.id, url: source.url, checkedAt: now, status: 'ok', fingerprint: sourceFingerprint(body) });
    } catch (error) {
      const message = `${source.id}: ${error.message}`;
      errors.push(message);
      sources.push({ id: source.id, url: source.url, checkedAt: now, status: 'error', error: error.message });
    }
  }
  return { status: errors.length ? 'partial' : 'complete', checkedAt: now, updatesStatus: 'complete', updatesCount: notices.length, notices, sources, errors };
}
