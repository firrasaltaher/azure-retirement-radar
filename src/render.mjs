import { readFile } from 'node:fs/promises';
import { htmlEscape, safeLink, addMonths, daysBetween, classify, noticeInWindow } from './model.mjs';

const [css, script] = await Promise.all([
  readFile(new URL('./report.css', import.meta.url), 'utf8'),
  readFile(new URL('./report.js', import.meta.url), 'utf8'),
]);

const themeScript = `(() => {
    const param = new URLSearchParams(window.location.search).get("scoutTheme");
    const theme =
      param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  })();`;

const e = (value) => htmlEscape(value ?? '');
const list = (value) => Array.isArray(value) ? value : [];
const anchor = (prefix, value) => `${prefix}-${String(value)}`;
const fragment = (id) => `#${encodeURIComponent(id)}`;
const localEdition = (id) => encodeURIComponent(String(id));
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const prettyDate = (value) => value ? dateFormat.format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`)) : 'Not established';
const prettyMonth = (value) => monthFormat.format(new Date(`${value}-01T00:00:00Z`));
const time = (value) => value ? `<time datetime="${e(value)}">${e(prettyDate(value))}</time>` : 'Not established';
const badge = (label, style = '') => `<span class="badge${style ? ` badge-${style}` : ''}">${e(label)}</span>`;
const remote = (url, label) => `<a href="${e(safeLink(url))}" rel="noreferrer">${e(label)}</a>`;
const sourceLink = (source) => `${remote(source.url, source.title)}<span class="source-url mono">${e(source.url)}</span>`;
const sectionHeader = (number, title, intro) => `<p class="section-number">${e(number)}</p><h2>${e(title)}</h2>${intro ? `<p class="section-intro">${e(intro)}</p>` : ''}`;
const empty = (text) => `<p class="empty">${e(text)}</p>`;
const statusLabel = (status) => ({ complete: 'Complete collection', partial: 'Partial collection', baseline: 'Seed baseline · no live refresh' })[status] || String(status);

function reviewState(reviewedOn, asOf) {
  if (!reviewedOn) return { stale: true, label: 'Semantic review not established', age: null };
  const age = daysBetween(reviewedOn, asOf);
  if (age < 0) return { stale: true, label: 'Review date after edition · confirm', age };
  return {
    stale: age > 31,
    age,
    label: age > 31 ? `Review overdue · ${age} days old` : `Semantic review · ${prettyDate(reviewedOn)}`,
  };
}

function evidence(ids, sources) {
  const items = list(ids).map((id) => {
    const source = sources.get(id);
    return source
      ? `<li>${sourceLink(source)}</li>`
      : `<li>Source reference ${e(id)}: evidence not established in this snapshot.</li>`;
  });
  return items.length ? `<ul class="evidence-list">${items.join('')}</ul>` : '<p class="muted">Evidence not established.</p>';
}

function citedNoticeSources(catalog) {
  const cited = new Map();
  for (const source of list(catalog.sources)) {
    const url = new URL(source.url);
    if (url.hostname !== 'www.microsoft.com' || !/^\/releasecommunications\/api\/v2\/azure\/?$/i.test(url.pathname)) continue;
    const filter = url.searchParams.get('$filter') || '';
    for (const match of filter.matchAll(/\bid\s+eq\s+'((?:''|[^'])*)'/gi)) {
      const id = match[1].replaceAll("''", "'");
      if (!cited.has(id)) cited.set(id, []);
      cited.get(id).push(source.id);
    }
  }
  return cited;
}

function shell(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Azure Retirement Radar: an archived public-source planning brief. Customer applicability is not assessed.">
<meta name="color-scheme" content="light dark">
<title>${e(title)}</title>
<script>${themeScript}</script>
<style>${css}</style>
</head>
<body>
<a class="skip-link no-print" href="#main">Skip to report content</a>
<div class="page">${content}</div>
<script>${script}</script>
</body>
</html>`.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
}

function toolbar() {
  return `<div class="toolbar controls" data-js-control hidden aria-label="Report display controls">
  <button type="button" data-presentation aria-pressed="false">Presentation text</button>
  <button type="button" data-print>Print / save PDF</button>
  <span class="toolbar-note" data-print-note>Preview may block printing or links. Download this HTML and open it in a browser; source URLs remain readable.</span>
</div>`;
}

function entryCard(entry, snapshot, sources, assistance) {
  const { asOf } = snapshot.edition;
  const window = classify(entry.date, asOf);
  const days = daysBetween(asOf, entry.date);
  const review = reviewState(entry.reviewedOn, asOf);
  const route = assistance.get(entry.assistanceId);
  const isNew = list(snapshot.changes.newEntries).includes(entry.id);
  const isUpdated = list(snapshot.changes.updatedEntries).some((item) => item.id === entry.id);
  const changedSources = list(entry.sourceIds).filter((id) => list(snapshot.changes.changedSourceIds).includes(id));
  const search = [entry.id, entry.title, entry.family, entry.kind, entry.date, entry.consequence, entry.action, entry.discovery, entry.notes].join(' ');
  return `<details class="entry" id="${e(anchor('entry', entry.id))}" data-register-entry data-family="${e(entry.family)}" data-window="${e(window)}" data-conflict="${entry.confidence === 'conflict'}" data-stale="${review.stale}" data-source-changed="${changedSources.length > 0}" data-search="${e(search)}" open>
  <summary><span class="entry-summary"><span>
    <span class="entry-title"><span class="entry-id">${e(entry.id)}</span>${e(entry.title)}</span>
    <span class="entry-family">${e(entry.family)} · ${e(entry.kind)}</span>
    <span class="badge-row">${badge(window, window === 'Past milestone' ? 'danger' : '')}${entry.confidence === 'conflict' ? badge('Source conflict · flagged, not verified', 'warning') : badge('Official source')}${review.stale ? badge(review.label, 'warning') : ''}${isNew ? badge(`${snapshot.edition.previousEditionId ? 'New entry' : 'Baseline entry'} · impact not assessed`, 'accent') : ''}${isUpdated ? badge('Updated entry', 'accent') : ''}${changedSources.length ? badge('Source changed · review pending', 'warning') : ''}</span>
  </span><span class="entry-date">${time(entry.date)}<small>${days < 0 ? `${Math.abs(days)} days elapsed` : days === 0 ? 'Milestone today' : `${days} days remaining`}</small></span></span></summary>
  <div class="entry-body">
    <div class="detail-grid">
      <div><p class="detail-label">What changes</p><p>${e(entry.consequence)}</p></div>
      <div><p class="detail-label">Recommended action</p><p>${e(entry.action)}</p></div>
      <div><p class="detail-label">Discovery / applicability check</p><p>${e(entry.discovery)}</p></div>
      <div><p class="detail-label">Scope / important distinctions</p><p>${e(entry.notes)}</p></div>
      <div class="detail-wide"><p class="detail-label">Assistance route · fit not established</p>${route ? `<p><a href="${e(fragment(anchor('assistance', route.id)))}">${e(route.title)}</a></p><p>${e(route.scope)}</p><p class="muted">${e(route.boundary)}</p>` : '<p>Not established. Confirm a suitable provider, entitlement, scope, and delivery capacity.</p>'}</div>
      <div class="detail-wide"><p class="detail-label">Official evidence · copy-readable URLs</p>${changedSources.length ? `<p class="brief-callout small"><strong>Source fingerprint changes:</strong> ${changedSources.map((id) => `<a href="${e(fragment(anchor('source', id)))}">${e(id)}</a>`).join(', ')}. Pending semantic review; a fetched-content change does not confirm a changed retirement date or advance reviewedOn. Collection checkedAt / fetchedAt: <span class="mono">${e(snapshot.collection.checkedAt || 'Not established')}</span>.</p>` : ''}${evidence(entry.sourceIds, sources)}</div>
    </div>
    <div class="entry-meta">
      <span>Last semantic review: <strong>${time(entry.reviewedOn)}</strong></span>
      ${review.stale ? badge(review.label, 'warning') : ''}
      <span>Customer applicability: <strong>Not assessed</strong></span>
      <span>Accountable owner / closure: <strong>Not established</strong></span>
    </div>
  </div>
</details>`;
}

function timeline(entries, asOf) {
  const end = addMonths(asOf, 6);
  const groups = new Map();
  let month = `${asOf.slice(0, 7)}-01`;
  while (month.slice(0, 7) <= end.slice(0, 7)) {
    groups.set(month.slice(0, 7), []);
    month = addMonths(month, 1);
  }
  entries.filter((entry) => entry.date >= asOf && entry.date <= end)
    .forEach((entry) => groups.get(entry.date.slice(0, 7))?.push(entry));
  return `<div class="timeline">${Array.from(groups, ([monthKey, monthEntries]) => `<article class="month">
    <h3>${e(prettyMonth(monthKey))}</h3><div class="month-count">${monthEntries.length}</div><span class="small muted">curated milestones</span>
    ${monthEntries.length ? `<ul>${monthEntries.map((entry) => `<li><time datetime="${e(entry.date)}">${e(prettyDate(entry.date))}</time><a href="${e(fragment(anchor('entry', entry.id)))}">${e(entry.title)}</a></li>`).join('')}</ul>` : '<p class="small muted">None in the curated register for this interval.</p>'}
  </article>`).join('')}</div>`;
}

function weeklyChanges(snapshot, entries, sources) {
  const changes = snapshot.changes;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const notices = new Map(list(snapshot.collection.notices).map((notice) => [notice.id, notice]));
  const cited = citedNoticeSources(snapshot.catalog);
  const baseline = !snapshot.edition.previousEditionId || snapshot.collection.status === 'baseline';
  const rows = [];
  const row = (type, subject, detail, treatment) => `<tr><td>${badge(type)}</td><th scope="row" class="table-title">${subject}</th><td>${detail}</td><td>${treatment}</td></tr>`;
  list(changes.newEntries).forEach((id) => {
    const entry = byId.get(id);
    rows.push(row(baseline ? 'Baseline entry' : 'New entry', entry ? `<a href="${e(fragment(anchor('entry', id)))}">${e(entry.title)}</a>` : e(id), entry ? `Planning milestone: ${time(entry.date)}.` : 'See archived catalog.', baseline ? 'Initial catalog inclusion, not a new announcement this week; customer impact is not assessed.' : 'New to the curated register; customer impact is not assessed.'));
  });
  list(changes.updatedEntries).forEach((entry) => {
    rows.push(row('Updated entry', e(entry.title || entry.id), `Changed fields: ${e(list(entry.fields).join(', ') || 'Not specified')}.<br>Previous date: ${time(entry.previousDate)}.<br>Current date: ${time(entry.date)}.`, 'Review the changed scope and evidence before changing a plan; no customer impact assessment is implied.'));
  });
  list(changes.removedEntries).forEach((entry) => {
    rows.push(row('Removed entry', e(entry.title || entry.id), `Previous planning date: ${time(entry.date)}.`, 'Removal from this catalog is not evidence that a customer has remediated or that the service notice was cancelled.'));
  });
  for (const [key, label] of [['newNoticeIds', baseline ? 'Baseline discovery' : 'Newly observed notice'], ['changedNoticeIds', 'Changed public notice']]) {
    list(changes[key]).forEach((id) => {
      const notice = notices.get(id);
      if (!notice || !noticeInWindow(notice, snapshot.edition.asOf)) return;
      const overlap = cited.get(id);
      const destination = overlap ? anchor('source', overlap[0]) : anchor('notice', id);
      rows.push(row(label, `<a href="${e(fragment(destination))}">${e(notice.title)}</a>`, key === 'changedNoticeIds' ? 'Public announcement content changed; pending semantic review.' : baseline ? 'First collection discovery; not evidence that the announcement was published this week.' : 'First observed in this archive; publication may predate this edition.', overlap ? `Already cited in catalog evidence (${e(overlap.join(', '))}); not a second retirement. Customer applicability is not assessed.` : 'Pending review, not a newly confirmed exact deadline or distinct customer exposure. Customer applicability is not assessed.'));
    });
  }
  list(changes.changedSourceIds).forEach((id) => {
    const source = sources.get(id);
    rows.push(row('Source fingerprint', source ? `<a href="${e(fragment(anchor('source', id)))}">${e(source.title)}</a>` : e(id), 'The fetched source content fingerprint changed.', 'A content hash is a review signal, not evidence that a retirement date or consequence changed.'));
  });
  return rows.length ? `<div class="table-wrap" role="region" aria-label="Changes since previous edition" tabindex="0"><table>
    <caption>Compared with ${snapshot.edition.previousEditionId ? e(snapshot.edition.previousEditionId) : 'no prior edition (initial baseline)'}; notice rows are limited to the current six-month review window and undated notices.</caption>
    <thead><tr><th scope="col">Change</th><th scope="col">Item</th><th scope="col">Observed difference</th><th scope="col">Interpretation</th></tr></thead><tbody>${rows.join('')}</tbody>
  </table></div>` : empty('No recorded changes in this comparison window. This does not establish unchanged Microsoft guidance, complete discovery, or customer remediation.');
}

function noticeQueue(snapshot) {
  const newIds = new Set(list(snapshot.changes.newNoticeIds));
  const changedIds = new Set(list(snapshot.changes.changedNoticeIds));
  const cited = citedNoticeSources(snapshot.catalog);
  const baseline = !snapshot.edition.previousEditionId || snapshot.collection.status === 'baseline';
  const inWindow = list(snapshot.collection.notices).filter((notice) => noticeInWindow(notice, snapshot.edition.asOf));
  const overlaps = inWindow.filter((notice) => cited.has(notice.id));
  const notices = inWindow.filter((notice) => !cited.has(notice.id))
    .sort((a, b) => String(b.modified || b.created || '').localeCompare(String(a.modified || a.created || '')) || String(a.id).localeCompare(String(b.id)));
  const start = snapshot.edition.asOf.slice(0, 7);
  const end = addMonths(snapshot.edition.asOf, 6).slice(0, 7);
  return `<p class="section-intro">${notices.length} candidate public notices with a referenced month in ${e(prettyMonth(start))}–${e(prettyMonth(end))}, or no recognized month. ${overlaps.length} matching notices already cited by exact Azure Update ID in catalog evidence are excluded from this candidate queue, not counted as additional retirements. All candidates remain pending review; announcement month extraction does not confirm a retirement deadline.</p>
  <p class="small muted">${baseline ? 'Baseline discovery establishes the initial observed set; these are not announcements newly published this week.' : 'Newly observed means first seen in this archive, not necessarily first published this week.'} Other potential overlaps require manual reconciliation; candidate notices are not a count of distinct retirements or affected workloads.</p>
  ${notices.length ? `<div class="two-column">${notices.map((notice) => {
    const months = list(notice.months);
    return `<article class="notice-card" id="${e(anchor('notice', notice.id))}">
      <div class="badge-row">${badge('Pending review', 'warning')}${baseline ? badge('Baseline discovery', 'accent') : newIds.has(notice.id) ? badge('Newly observed announcement', 'accent') : changedIds.has(notice.id) ? badge('Changed announcement', 'accent') : badge('Retained for review')}</div>
      <h3>${e(notice.title)}</h3>
      <p><strong>${months.length ? months.map((month) => e(prettyMonth(month))).join(' · ') : 'Date not established'}</strong><br><span class="small muted">${months.length ? 'Referenced month only — not an exact retirement deadline.' : 'No recognized deadline month; retained for manual review.'}</span></p>
      <p class="small"><strong>Products:</strong> ${e(list(notice.products).join(', ') || 'Not specified')}<br><strong>Customer applicability:</strong> Not assessed</p>
      <p class="small muted">Published month: ${notice.created ? e(prettyMonth(String(notice.created).slice(0, 7))) : 'Not established'} · Modified month: ${notice.modified ? e(prettyMonth(String(notice.modified).slice(0, 7))) : 'Not established'}</p>
      <details open><summary>Official API evidence / readable URL</summary><p class="source-details">${remote(notice.sourceUrl, 'Open official Microsoft announcement API')}<span class="source-url mono">${e(notice.sourceUrl)}</span></p><p class="small muted">Notice ID: <span class="mono">${e(notice.id)}</span></p></details>
    </article>`;
  }).join('')}</div>` : empty(snapshot.collection.status === 'baseline' ? 'No live public notices were collected for this seed-only baseline. This is not an empty retirement horizon.' : overlaps.length ? 'All matching collected notices are already cited in catalog evidence. No additional candidates remain in this queue; this is not proof that no other announcements exist.' : 'No collected notices match this window. Collection coverage and failures below still apply; this is not proof that no announcements exist.')}`;
}

function sourceCoverage(snapshot, sources) {
  const collection = snapshot.collection;
  const checks = list(collection.sources);
  const ok = checks.filter((source) => source.status === 'ok').length;
  const failures = checks.filter((source) => source.status === 'error');
  const checkedIds = new Set(checks.map((source) => source.id));
  const notChecked = Array.from(sources.values()).filter((source) => !checkedIds.has(source.id));
  return `<div class="panel">
    <div class="heading-row"><h3>Collection is evidence retrieval, not semantic verification</h3>${badge(statusLabel(collection.status), collection.status === 'complete' ? 'success' : 'warning')}</div>
    <p>${collection.status === 'baseline' ? 'This is a seed-only baseline. No live refresh was performed; use the displayed semantic-review dates and recheck current official guidance before committing to action.' : collection.status === 'partial' ? 'One or more collection operations did not complete. Retrieved evidence and the existing curated catalog remain visible, but missing or failed reads reduce coverage.' : 'The configured collection completed. “Complete” means configured sources were read, not that every Azure retirement was found or that existing dates, scope, and consequences were freshly reviewed.'}</p>
    <div class="coverage-grid">
      <div><span class="coverage-number">${ok} / ${checks.length}</span>source checks succeeded</div>
      <div><span class="coverage-number">${failures.length}</span>failed source checks</div>
      <div><span class="coverage-number">${e(collection.updatesCount ?? 0)}</span>public notices reported by collector</div>
    </div>
    <p class="small"><strong>Collection checkedAt / fetchedAt:</strong> <span class="mono">${e(collection.checkedAt || 'Not established')}</span><br><strong>Updates feed status:</strong> ${e(collection.updatesStatus || 'Not established')}<br><strong>Curated evidence sources not represented by a source check:</strong> ${notChecked.length} of ${sources.size}.</p>
    <p class="small muted">Configured public sources are not exhaustive. This report does not read a customer tenant, Advisor recommendations, Service Health events, installed dependencies, or workload inventories. Fetch timestamps and hashes never reset semantic-review dates.</p>
    ${list(collection.errors).length ? `<div class="brief-callout"><h4>Collection errors</h4><ul>${collection.errors.map((error) => `<li>${e(error)}</li>`).join('')}</ul></div>` : ''}
    ${failures.length ? `<div class="brief-callout"><h4>Failed sources · ${failures.length}</h4><ul>${failures.map((source) => `<li><strong>${e(sources.get(source.id)?.title || source.id)}</strong> — ${e(source.error || 'Read failed; no further detail supplied.')}<br>${source.url ? sourceLink({ title: 'Official source', url: source.url }) : ''}</li>`).join('')}</ul></div>` : ''}
  </div>
  <details class="source-details print-evidence" open><summary>Source check register · ${checks.length} recorded checks</summary>
    ${checks.length ? `<div class="table-wrap" role="region" aria-label="Source collection checks" tabindex="0"><table><thead><tr><th scope="col">Official source</th><th scope="col">Result / retrieved at</th><th scope="col">Evidence fingerprint / error</th></tr></thead><tbody>${checks.map((source) => `<tr><th scope="row">${source.url ? sourceLink({ title: sources.get(source.id)?.title || source.id, url: source.url }) : e(source.id)}</th><td>${badge(source.status === 'ok' ? 'Read succeeded' : 'Read failed', source.status === 'ok' ? 'success' : 'danger')}<br><span class="small mono">${e(source.checkedAt || 'Not established')}</span></td><td class="mono small">${e(source.fingerprint || source.error || 'Not established')}</td></tr>`).join('')}</tbody></table></div>` : empty('No live source checks are recorded in this snapshot.')}
    ${notChecked.length ? `<p class="small muted">No recorded source check for: ${notChecked.map((source) => `<a href="${e(fragment(anchor('source', source.id)))}">${e(source.title)}</a>`).join('; ')}.</p>` : ''}
  </details>`;
}

export function renderReport(snapshot) {
  const { catalog, edition, collection } = snapshot;
  const { asOf } = edition;
  const entries = [...list(catalog.entries)].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const sources = new Map(list(catalog.sources).map((source) => [source.id, source]));
  const assistance = new Map(list(catalog.assistance).map((route) => [route.id, route]));
  const counts = new Map(['Past milestone', '0-3 months', '3-6 months', 'Beyond horizon'].map((window) => [window, 0]));
  entries.forEach((entry) => { const window = classify(entry.date, asOf); counts.set(window, counts.get(window) + 1); });
  const immediate = entries.filter((entry) => { const days = daysBetween(asOf, entry.date); return days >= 0 && days <= 30; });
  const overdueReviews = entries.filter((entry) => reviewState(entry.reviewedOn, asOf).stale).length;
  const catalogReview = reviewState(catalog.reviewedOn, asOf);
  const families = [...new Set(entries.map((entry) => entry.family))].sort((a, b) => a.localeCompare(b));
  const through = addMonths(asOf, 6);
  const content = `
<header class="masthead">
  <div class="topline"><span class="brand"><span class="brand-mark" aria-hidden="true"></span>AZURE / RETIREMENT INTELLIGENCE</span><a href="../../index.html">Edition archive</a></div>
  <div class="hero">
    <div><p class="eyebrow">Plan the transition. Preserve the evidence.</p><h1>Azure Retirement Radar</h1><p class="subtitle">Public-source planning brief | Customer applicability not assessed</p></div>
    <div class="edition-meta"><p class="edition-date">${time(asOf)}</p><p class="meta-line">Planning horizon through ${time(through)}</p><p class="meta-line">Last catalog semantic review: <strong>${time(catalog.reviewedOn)}</strong></p><p class="meta-line">Source fetchedAt / collection checkedAt: <span class="mono">${e(collection.checkedAt || 'Not established')}</span></p><div class="badge-row">${badge(statusLabel(collection.status), collection.status === 'complete' ? '' : 'warning')}${catalogReview.stale ? badge(catalogReview.label, 'warning') : ''}</div></div>
  </div>
</header>
<nav class="section-nav no-print" aria-label="Report sections">
  <a href="#executive">Executive brief</a><a href="#timeline">Six-month view</a><a href="#immediate">Next 30 days</a><a href="#changes">Weekly changes</a><a href="#register">Retirement register</a><a href="#notices">Review queue</a><a href="#conflicts">Date conflicts</a><a href="#coverage">Source coverage</a><a href="#queries">Impact query pack</a><a href="#assistance">Assistance</a><a href="#sources">Sources</a>
</nav>
${toolbar()}
<noscript><p class="brief-callout small">JavaScript is disabled. All evidence and every register entry remain available below; native disclosure controls and links still work. Use your browser’s Find and Print commands.</p></noscript>
<main id="main">
  <section id="executive">
    ${sectionHeader('01 / Decision brief', 'A planning signal, not an impact assessment')}
    <div class="summary-grid">
      <div class="panel"><p class="lead"><strong>${immediate.length} curated milestones fall within the next 30 days</strong> of this edition. ${counts.get('0-3 months')} fall in the first three months and ${counts.get('3-6 months')} in the following three. Prioritize discovery and confirm the applicable service notice before committing a migration date.</p><p>The register distinguishes support end, service shutdown, image removal, automatic conversion, and other operational milestones. These are not interchangeable events. Public-source dates do not identify affected customers or prove remediation.</p><p class="small muted">All ${entries.length} curated entries are included, including past milestones and dates beyond the horizon. ${overdueReviews} entries have a semantic review older than 31 days or no established review date.</p></div>
      <aside class="brief-callout"><h3>Decisions for the next review</h3><ol class="decision-list"><li>Confirm exposure using scoped inventory, application dependencies, and authoritative service guidance.</li><li>Assign an accountable service owner and agree a supported target, cutover, and recovery plan.</li><li>Resolve date discrepancies conservatively; accept closure only with tested, retained evidence.</li></ol><hr><p class="small"><strong>Customer impact:</strong> Not assessed<br><strong>Ownership, cost, and closure:</strong> Not established</p></aside>
    </div>
    <div class="stat-grid">
      <div class="stat"><span class="stat-number">${counts.get('Past milestone')}</span><span class="stat-label">Past milestone</span><span class="stat-note">Curated register only; backlog is separate</span></div>
      <div class="stat"><span class="stat-number">${counts.get('0-3 months')}</span><span class="stat-label">Next 3 months</span><span class="stat-note">${e(prettyDate(asOf))} to ${e(prettyDate(addMonths(asOf, 3)))}</span></div>
      <div class="stat"><span class="stat-number">${counts.get('3-6 months')}</span><span class="stat-label">Following 3 months</span><span class="stat-note">After ${e(prettyDate(addMonths(asOf, 3)))} through ${e(prettyDate(through))}</span></div>
      <div class="stat"><span class="stat-number">${list(catalog.conflicts).length}</span><span class="stat-label">Source conflicts</span><span class="stat-note">Discrepancies and corrected historical dates</span></div>
    </div>
    <p class="count-note">Counts represent public milestones, not impacted resources, customers, or unique workloads. ${counts.get('Beyond horizon')} curated milestones are beyond this horizon. Collection completion is not fresh semantic verification.</p>
  </section>
  <section id="timeline">
    ${sectionHeader('02 / Horizon', 'Six-month planning timeline', `Grouped by calendar month from ${prettyDate(asOf)} through ${prettyDate(through)}, inclusive. The first and final calendar months can be partial. Select a milestone for scope, action, and evidence.`)}
    ${timeline(entries, asOf)}
  </section>
  <section id="immediate">
    ${sectionHeader('03 / Immediate attention', 'Within 30 days · validate exposure now', 'This inclusive 0–30-day view is anchored to the edition date, not the date the HTML is opened. Past milestones and unresolved conflicts must also be reviewed; absence here is not clearance.')}
    ${immediate.length ? `<div class="table-wrap" role="region" aria-label="Milestones within 30 days" tabindex="0"><table><thead><tr><th scope="col">Planning date</th><th scope="col">Milestone / consequence</th><th scope="col">Next action</th></tr></thead><tbody>${immediate.map((entry) => `<tr><td class="date-cell">${time(entry.date)}<br>${badge(`${daysBetween(asOf, entry.date)} days`, 'accent')}</td><td class="table-title"><a href="${e(fragment(anchor('entry', entry.id)))}"><strong>${e(entry.title)}</strong></a><p>${e(entry.consequence)}</p></td><td class="table-action">${e(entry.action)}<p class="small muted">Customer applicability: Not assessed.</p></td></tr>`).join('')}</tbody></table></div>` : empty('No curated milestones fall in the next 30 days. Check past milestones, unresolved conflicts, and source coverage before concluding that no action is needed.')}
    ${list(catalog.conflicts).length ? '<p class="brief-callout small">Also review the <a href="#conflicts">date-conflict register</a>. Items kept outside the dated register can still require urgent action; later dates must not be treated as a grace period.</p>' : ''}
  </section>
  <section id="changes">
    ${sectionHeader('04 / Edition comparison', 'What changed this week', 'Changes are relative to the previous archived snapshot, not necessarily a seven-day interval. Catalog edits, newly observed announcements, and source fingerprint changes have different meanings.')}
    ${weeklyChanges(snapshot, entries, sources)}
  </section>
  <section id="register">
    ${sectionHeader('05 / Curated register', 'Retirement scope, action, and evidence', 'Every curated milestone is preserved. Expand any entry for its consequence, discovery checks, action, assistance boundaries, source URLs, and last semantic review. No customer applicability assessment has been performed.')}
    <div class="filters panel controls" data-js-control hidden>
      <label>Search the register<input type="search" data-search placeholder="Service, date, scope, or action" aria-controls="register-entries"></label>
      <label>Service family<select data-family-filter aria-controls="register-entries"><option value="">All families</option>${families.map((family) => `<option value="${e(family)}">${e(family)}</option>`).join('')}</select></label>
      <label>Milestone window<select data-window-filter aria-controls="register-entries"><option value="">All dates</option>${Array.from(counts.keys()).map((window) => `<option value="${e(window)}">${e(window)}</option>`).join('')}</select></label>
      <label>Review status<select data-status-filter aria-controls="register-entries"><option value="">All review statuses</option><option value="conflict">Source conflict</option><option value="changed">Source changed / review pending</option><option value="stale">Review overdue / unknown</option><option value="recent">Reviewed within 31 days</option></select></label>
      <button type="button" data-clear-filters>Reset</button>
    </div>
    <div class="toolbar controls" data-js-control hidden><button type="button" data-expand-all>Expand shown entries</button><button type="button" data-collapse-all>Collapse entries</button><span class="toolbar-note">Print includes all entries and evidence, regardless of filters.</span></div>
    <p class="filter-result" data-filter-result aria-live="polite" role="status">Showing ${entries.length} of ${entries.length} curated milestones. Customer applicability: Not assessed.</p>
    <p class="empty no-print" data-filter-empty hidden>No entries match these filters. Reset the filters to restore the complete register.</p>
    <div class="entries" id="register-entries">${entries.map((entry) => entryCard(entry, snapshot, sources, assistance)).join('')}</div>
  </section>
  <section id="notices">
    ${sectionHeader('06 / Public announcements', 'New / changed notices · pending review')}
    ${noticeQueue(snapshot)}
  </section>
  <section id="conflicts">
    ${sectionHeader('07 / Resolve before commitment', 'Date conflicts and corrected expectations', 'Current service guidance, older announcements, and cross-service catalogs can disagree. The rationale below is preserved as reviewed; a new source fetch does not reconcile it.')}
    <div class="two-column">${list(catalog.conflicts).map((conflict) => `<article class="panel" id="${e(anchor('conflict', conflict.id))}"><h3>${e(conflict.title)}</h3><p>${e(conflict.summary)}</p><p><strong>Planning treatment:</strong> ${e(conflict.treatment)}</p>${evidence(conflict.sourceIds, sources)}<p class="small muted">Catalog semantic review: ${time(catalog.reviewedOn)}. Customer applicability: Not assessed.</p></article>`).join('')}</div>
    ${!list(catalog.conflicts).length ? empty('No date discrepancies are recorded in this catalog; this is not a guarantee that all official sources agree.') : ''}
  </section>
  <section id="backlog">
    ${sectionHeader('08 / Residual exposure', 'Recent backlog · closure not established', 'Previously identified milestones remain actionable until scoped discovery and remediation evidence establish closure. Published support end does not by itself establish a service shutdown.')}
    <div class="stack">${list(catalog.backlog).map((item) => `<article class="panel" id="${e(anchor('backlog', item.id))}"><div class="heading-row"><h3>${e(item.title)}</h3>${badge(item.date < asOf ? 'Past milestone' : classify(item.date, asOf), item.date < asOf ? 'danger' : '')}</div><p class="small">${time(item.date)} · Customer applicability: Not assessed · Closure: Not established</p><p>${e(item.summary)}</p>${evidence(item.sourceIds, sources)}</article>`).join('')}</div>
  </section>
  <section id="coverage">
    ${sectionHeader('09 / Collection transparency', 'Source coverage and freshness', 'Separate when content was retrieved from when its meaning was reviewed. Only an explicit catalog review changes reviewedOn; collection timestamps and content hashes do not.')}
    ${sourceCoverage(snapshot, sources)}
  </section>
  <section id="queries">
    ${sectionHeader('10 / Discovery starter pack', 'Impact query pack · inspect, do not infer', 'Read-only query examples for an authorized operator to review and run separately in Azure Resource Graph. They have not been executed for any customer and do not make a complete impact assessment. There are no execution controls in this report.')}
    <div class="brief-callout"><p><strong>Cross-query limitations:</strong> Confirm permissions, subscription and resource scope, service coverage, and indexing freshness. Retrieve all pages, including results beyond 1,000 rows. No matches does not establish no exposure; inspect guest operating systems, application dependencies, SDKs, protocols, and deployed configuration separately.</p></div>
    <div class="stack">${list(catalog.queries).map((query) => `<article class="panel" id="${e(anchor('query', query.id))}"><h3>${e(query.title)}</h3><p>${e(query.description)}</p><pre><code>${e(query.kql)}</code></pre><p><strong>Limitations:</strong> ${e(query.limitations)}</p>${evidence(query.sourceIds, sources)}</article>`).join('')}</div>
  </section>
  <section id="assistance">
    ${sectionHeader('11 / Delivery routes', 'Assistance is a fit check, not a commitment', 'Public retirement announcements are available independently of Unified. The potential value of a support or delivery engagement is scoped discovery, decisions, accountable ownership, migration validation, and evidence-based closure—not exclusive access to this public feed.')}
    <div class="brief-callout"><p>No eligibility, entitlement, price, contract coverage, delivery capacity, or retirement-specific end-to-end package is established by this report. Confirm each before committing. A route mapped to an entry does not mean the work is automatically covered or free.</p></div>
    <div class="stack">${list(catalog.assistance).map((route) => `<article class="panel" id="${e(anchor('assistance', route.id))}"><h3>${e(route.title)}</h3><p>${e(route.scope)}</p><p><strong>Scope and commitment boundary:</strong> ${e(route.boundary)}</p>${evidence(route.sourceIds, sources)}</article>`).join('')}</div>
  </section>
  <section id="governance">
    ${sectionHeader('12 / Operational outcome', 'From public signal to verified closure', 'Use these outcomes in a separately controlled customer workstream. This public-only archive stores no customer inventory, decisions, owners, or remediation evidence.')}
    <div class="summary-grid">
      <div class="panel"><ol class="workflow"><li><span><strong>Establish applicability</strong>Record the authorized scope, affected resources and dependencies, evidence source, and confidence. Validate negative results, not just positive matches.</span></li><li><span><strong>Name accountable ownership</strong>Agree the service owner, technical delivery owner, decision authority, and escalation route. Ownership here is Not established.</span></li><li><span><strong>Agree the transition</strong>Record the supported target, applicable deadline, service-specific consequence, funding, prerequisites, change window, and tested rollback.</span></li><li><span><strong>Validate the outcome</strong>Demonstrate the supported version or configuration, successful functional and resilience checks, operational readiness, and removal of old dependencies.</span></li><li><span><strong>Accept and preserve closure</strong>Obtain accountable acceptance, retain evidence and residual-risk decisions, then track remaining exceptions. A dismissed recommendation is not proof of remediation.</span></li></ol></div>
      <aside class="brief-callout"><h3>Presentation guardrails</h3><p>Say <strong>“potential exposure to assess”</strong>, not “affected customer.” Say <strong>“published planning milestone”</strong>, not “verified shutdown” unless the service guidance explicitly establishes it.</p><p>Report discovered scope, owner acceptance, validated migration, and closure evidence only after that work actually occurs.</p><p class="small">Customer impact: Not assessed.<br>Delivery owner: Not established.<br>Remediation / cost / closure: Not established.</p></aside>
    </div>
  </section>
  <section id="sources">
    ${sectionHeader('13 / Evidence appendix', 'Official source library', 'All references are public Microsoft sources. URLs are printed in full for copying when a preview sandbox blocks links. An official source is not a guarantee that every source agrees or that it was successfully refreshed.')}
    <ol class="source-list">${list(catalog.sources).map((source, index) => `<li id="${e(anchor('source', source.id))}"><span class="small muted">${String(index + 1).padStart(2, '0')} / ${e(source.id)}</span><br><span class="source-title">${sourceLink(source)}</span></li>`).join('')}</ol>
  </section>
  <section id="archive">
    ${sectionHeader('14 / Reproducibility', 'An immutable planning snapshot')}
    <div class="panel"><p><strong>Snapshot ID:</strong> <span class="mono">${e(edition.id)}</span><br><strong>Edition as of:</strong> ${time(asOf)}<br><strong>Generated at:</strong> <span class="mono">${e(edition.generatedAt)}</span><br><strong>Reason:</strong> ${e(edition.reason)}<br><strong>Generator version:</strong> ${e(edition.generatorVersion)}</p><p>This standalone HTML preserves the evidence and collection state of one edition. It does not refresh itself. Weekly snapshots are append-only; revisions receive a distinct <span class="mono">-rN</span> identifier rather than overwriting a published week.</p><div class="archive-links"><a href="../../index.html">All archived editions</a><a href="snapshot.json">Snapshot JSON</a><a href="manifest.json">Integrity manifest</a>${edition.previousEditionId ? `<a href="../${e(localEdition(edition.previousEditionId))}/report.html">Previous snapshot: ${e(edition.previousEditionId)}</a>` : '<span class="muted">No previous snapshot</span>'}</div><p class="small muted">Keep report.html, snapshot.json, and manifest.json together. The archive index records the edition hash; verify the manifest with the generator tooling when checking integrity. This private-archive workflow does not require a public website.</p></div>
  </section>
</main>
<footer class="footer"><p><strong>Azure Retirement Radar</strong> · Public-source planning brief · Edition ${e(edition.id)}</p><p>Generic public information only. Customer applicability is not assessed. This file makes no network requests, uses no storage or external assets, and does not execute discovery queries. Dates are anchored to ${e(asOf)} and remain unchanged when opened later.</p></footer>`;
  return shell(`Azure Retirement Radar · ${prettyDate(asOf)}`, content);
}

export function renderIndex(editions) {
  const ordered = [...list(editions)].sort((a, b) => String(b.asOf).localeCompare(String(a.asOf))
    || String(b.id).localeCompare(String(a.id), undefined, { numeric: true })
    || String(b.generatedAt).localeCompare(String(a.generatedAt)));
  const latest = ordered[0];
  return shell('Azure Retirement Radar · Edition archive', `
<header class="masthead">
  <div class="topline"><span class="brand"><span class="brand-mark" aria-hidden="true"></span>AZURE / RETIREMENT INTELLIGENCE</span><span>Private archive · standalone HTML</span></div>
  <div class="hero"><div><p class="eyebrow">A durable record of every edition</p><h1>Azure Retirement Radar</h1><p class="subtitle">Public-source planning brief | Customer applicability not assessed</p></div><div class="edition-meta"><p class="edition-date">Edition archive</p><p class="meta-line">${ordered.length} immutable ${ordered.length === 1 ? 'snapshot' : 'snapshots'} · newest first</p><p class="meta-line">Public Microsoft evidence. No customer or private content.</p></div></div>
</header>
${toolbar()}
<main id="main">
  <section id="latest">${sectionHeader('01 / Start here', 'Latest archived brief')}
    ${latest ? `<div class="panel"><div class="heading-row"><h3>${e(prettyDate(latest.asOf))} · ${e(latest.id)}</h3>${badge(statusLabel(latest.status), latest.status === 'complete' ? '' : 'warning')}</div><p>${e(latest.entryCount)} curated milestones · ${e(latest.reason)}</p><p><a class="button-link primary" href="reports/${e(localEdition(latest.id))}/report.html">Open latest retirement brief</a></p><p class="small muted">Generated at ${e(latest.generatedAt)}. This is the latest archived edition, not a live service or a claim that its deadlines were recently revalidated.</p></div>` : empty('No editions have been generated yet. This index will list snapshots after the generator creates them.')}
  </section>
  <section id="archive-principles">${sectionHeader('02 / Archive contract', 'No week is overwritten')}
    <div class="summary-grid"><div class="panel"><p>Each edition lives under its own dated snapshot ID in <span class="mono">reports/</span>. Weekly snapshots are append-only. A correction or same-week revision receives a distinct <span class="mono">-rN</span> ID; prior editions remain available for comparison.</p><p>The HTML is a complete, self-contained public-source brief. The companion snapshot JSON preserves the underlying catalog, collection results, and change records. The integrity manifest records the generated files for verification.</p></div><aside class="brief-callout"><h3>Interpret collection status carefully</h3><p><strong>Baseline:</strong> seed catalog only; no live refresh.<br><strong>Partial:</strong> one or more collection operations failed.<br><strong>Complete:</strong> configured sources read; not exhaustive discovery or fresh semantic verification.</p><p class="small">Use the report’s semantic-review dates separately from fetch timestamps. Customer impact and closure remain unassessed.</p></aside></div>
  </section>
  <section id="editions">${sectionHeader('03 / All editions', 'Complete chronological archive', 'Every snapshot is listed below, newest first. Download the archive with its folder structure intact so local links continue to work. No public website or external resources are required.')}
    <div class="archive-grid">${ordered.map((edition, index) => {
      const path = `reports/${localEdition(edition.id)}`;
      return `<article class="archive-card"><div class="badge-row">${index === 0 ? badge('Latest edition', 'accent') : ''}${badge(statusLabel(edition.status), edition.status === 'complete' ? '' : 'warning')}</div><h3>${time(edition.asOf)}</h3><p class="mono small">${e(edition.id)}</p><p>${e(edition.entryCount)} curated milestones<br><span class="muted">${e(edition.reason)}</span></p><p class="small muted">Generated at ${e(edition.generatedAt)}</p><div class="archive-links"><a href="${e(path)}/report.html">Open report</a><a href="${e(path)}/snapshot.json">Snapshot JSON</a><a href="${e(path)}/manifest.json">Integrity manifest</a></div><p class="digest">Snapshot SHA-256<br><span class="mono">${e(edition.sha256 || 'Not established')}</span></p></article>`;
    }).join('')}</div>
    ${!ordered.length ? empty('The archive currently contains no snapshots.') : ''}
  </section>
</main>
<footer class="footer"><p><strong>Azure Retirement Radar</strong> · Public-source archive generated from the project’s reviewed catalog and collector snapshots.</p><p>No customer inventories, owner assignments, impact statistics, or private data are included. Browser preview may block local navigation or printing: download the files and open the HTML locally. This index contains no live feeds, network calls, storage, imports, or external assets.</p></footer>`);
}
