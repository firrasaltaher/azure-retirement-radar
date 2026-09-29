(() => {
  const body = document.body;
  const controls = document.querySelectorAll('[data-js-control]');
  controls.forEach((element) => { element.hidden = false; });

  const presentation = document.querySelector('[data-presentation]');
  if (presentation) {
    presentation.addEventListener('click', () => {
      const active = body.classList.toggle('presentation');
      presentation.setAttribute('aria-pressed', String(active));
      presentation.textContent = active ? 'Standard text' : 'Presentation text';
    });
  }

  const entries = Array.from(document.querySelectorAll('[data-register-entry]'));
  const search = document.querySelector('input[data-search]');
  const family = document.querySelector('[data-family-filter]');
  const windowFilter = document.querySelector('[data-window-filter]');
  const status = document.querySelector('[data-status-filter]');
  const result = document.querySelector('[data-filter-result]');
  const empty = document.querySelector('[data-filter-empty]');
  const normalize = (value) => value.toLocaleLowerCase().trim();

  const filterEntries = () => {
    const term = normalize(search?.value || '');
    let shown = 0;
    entries.forEach((entry) => {
      const matches = (!term || normalize(entry.dataset.search || '').includes(term))
        && (!family?.value || entry.dataset.family === family.value)
        && (!windowFilter?.value || entry.dataset.window === windowFilter.value)
        && (!status?.value
          || (status.value === 'conflict' && entry.dataset.conflict === 'true')
          || (status.value === 'changed' && entry.dataset.sourceChanged === 'true')
          || (status.value === 'stale' && entry.dataset.stale === 'true')
          || (status.value === 'recent' && entry.dataset.stale === 'false'));
      entry.hidden = !matches;
      if (matches) shown += 1;
    });
    if (result) result.textContent = `Showing ${shown} of ${entries.length} curated milestones. Customer applicability: Not assessed.`;
    if (empty) empty.hidden = shown !== 0;
  };

  if (entries.length) {
    entries.forEach((entry) => { entry.open = false; });
    search?.addEventListener('input', filterEntries);
    [family, windowFilter, status].forEach((control) => control?.addEventListener('change', filterEntries));
    document.querySelector('[data-clear-filters]')?.addEventListener('click', () => {
      [search, family, windowFilter, status].forEach((control) => { if (control) control.value = ''; });
      filterEntries();
    });
    document.querySelector('[data-expand-all]')?.addEventListener('click', () => {
      entries.forEach((entry) => { if (!entry.hidden) entry.open = true; });
    });
    document.querySelector('[data-collapse-all]')?.addEventListener('click', () => {
      entries.forEach((entry) => { entry.open = false; });
    });
  }

  const revealAnchor = () => {
    let id;
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (!target?.matches('[data-register-entry]')) return;
    if (target.hidden) {
      [search, family, windowFilter, status].forEach((control) => { if (control) control.value = ''; });
      filterEntries();
    }
    target.open = true;
  };
  window.addEventListener('hashchange', revealAnchor);
  document.querySelectorAll('a[href^="#entry-"]').forEach((link) => {
    link.addEventListener('click', () => {
      let target;
      try { target = document.getElementById(decodeURIComponent(link.hash.slice(1))); } catch { return; }
      if (target) {
        if (target.hidden) {
          [search, family, windowFilter, status].forEach((control) => { if (control) control.value = ''; });
          filterEntries();
        }
        target.open = true;
      }
    });
  });
  revealAnchor();

  let printState;
  const preparePrint = () => {
    if (printState) return;
    printState = {
      details: Array.from(document.querySelectorAll('details'), (element) => [element, element.open]),
      entries: entries.map((element) => [element, element.hidden]),
    };
    printState.details.forEach(([element]) => { element.open = true; });
    printState.entries.forEach(([element]) => { element.hidden = false; });
    body.classList.add('printing');
  };
  const restorePrint = () => {
    if (!printState) return;
    printState.details.forEach(([element, open]) => { element.open = open; });
    printState.entries.forEach(([element, hidden]) => { element.hidden = hidden; });
    printState = undefined;
    body.classList.remove('printing');
  };
  window.addEventListener('beforeprint', preparePrint);
  window.addEventListener('afterprint', restorePrint);
  const printButton = document.querySelector('[data-print]');
  const printNote = document.querySelector('[data-print-note]');
  printButton?.addEventListener('click', () => {
    if (typeof window.print !== 'function') {
      if (printNote) printNote.textContent = 'Printing is unavailable here. Download the HTML and use your browser’s Print command.';
      return;
    }
    preparePrint();
    try { window.print(); } catch {
      if (printNote) printNote.textContent = 'This preview blocks printing. Download the HTML and use your browser’s Print command.';
    } finally {
      restorePrint();
    }
  });
})();
