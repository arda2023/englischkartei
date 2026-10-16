// Kartenverwaltung: Suche, Filter, Sortierung, Mehrfachauswahl, Einzel-Aktionen, Import und KI-Export.

import * as store from './store.js';
import { escapeHtml, stripMarkup } from '../lib/markup.js';
import { isProblemCard, hasErrors, isDueToday, errorCount, lastAttempt, avgThinkingTime } from '../lib/export.js';
import { $, tagChips, relativeDue, openModal, toast, renderUserInput, fmtSeconds } from './ui.js';
import { openEditor } from './editor.js';
import { openDetails, copyCardHistory, ratingSummary } from './details.js';
import { openAiExport } from './aiexport.js';

let root;
let active = false;
const filters = { query: '', status: 'all', tag: 'all', sort: 'errors' };
const selected = new Set();
let visibleIds = [];
let lastCheckedIndex = null;

const STATUS_FILTERS = {
  all: ['Alle Karten', () => true],
  problems: ['Sorgenkinder', isProblemCard],
  errors: ['Mit Fehlern (mind. 1× falsch)', hasErrors],
  due: ['Heute fällig', (c) => isDueToday(c)],
  new: ['Noch nie geübt', (c) => c.history.length === 0],
};

const lastPracticed = (c) => (c.history.length ? Date.parse(lastAttempt(c).submittedAt) : 0);
const dueValue = (c) => (c.srs.state === 'new' ? Number.MAX_SAFE_INTEGER : Date.parse(c.srs.dueDate));

const SORTS = {
  errors: ['Meiste Fehler zuerst', (a, b) => errorCount(b) - errorCount(a) || errorRate(b) - errorRate(a)],
  recent: ['Zuletzt geübt', (a, b) => lastPracticed(b) - lastPracticed(a)],
  thinking: ['Längste Ø Denkzeit', (a, b) => avgThinkingTime(b) - avgThinkingTime(a)],
  due: ['Fälligkeitsdatum', (a, b) => dueValue(a) - dueValue(b)],
  created: ['Neueste zuerst', (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)],
};

function errorRate(card) {
  return card.history.length ? errorCount(card) / card.history.length : 0;
}

function matches(card) {
  const { query, status, tag } = filters;
  if (!STATUS_FILTERS[status][1](card)) return false;
  if (tag !== 'all' && !card.tags.includes(tag)) return false;
  if (query) {
    const hay = [card.German, card.English, card.Rule, card.tags.join(' '), ...card.history.map((a) => a.userInput)]
      .map(stripMarkup)
      .join('\n')
      .toLowerCase();
    return query
      .toLowerCase()
      .split(/\s+/)
      .every((w) => hay.includes(w));
  }
  return true;
}

function allTags() {
  const set = new Set();
  for (const c of store.cards()) c.tags.forEach((t) => set.add(t));
  return [...set].sort();
}

const options = (entries, value) =>
  entries.map(([v, l]) => `<option value="${escapeHtml(v)}" ${value === v ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('');

function renderShell() {
  const tags = allTags();
  if (filters.tag !== 'all' && !tags.includes(filters.tag)) filters.tag = 'all';
  root.innerHTML = `<div class="container wide">
    <div class="toolbar">
      <input type="search" class="search" id="card-search" placeholder="Suchen in Sätzen, Regeln, Tags und deinen Eingaben (⌘F) …" value="${escapeHtml(filters.query)}" />
      <select id="filter-tag" title="Tag">${options([['all', 'Alle Tags'], ...tags.map((t) => [t, t])], filters.tag)}</select>
      <select id="filter-status" title="Sorgenkinder = mind. 2× Nochmal/Schwer oder letzte Eingabe falsch">${options(Object.entries(STATUS_FILTERS).map(([k, [l]]) => [k, l]), filters.status)}</select>
      <select id="sort" title="Sortierung">${options(Object.entries(SORTS).map(([k, [l]]) => [k, l]), filters.sort)}</select>
    </div>
    <div class="selection-bar">
      <button class="btn small" data-action="select-visible">Alle sichtbaren auswählen</button>
      <button class="btn small ghost" data-action="clear-selection">Auswahl aufheben</button>
      <span class="muted small" id="selection-count"></span>
      <span class="spacer"></span>
      <span class="muted small" id="list-count"></span>
      <button class="btn small" data-action="import">Importieren</button>
      <button class="btn small" data-action="new">+ Neue Karte</button>
      <button class="btn small primary" data-action="ai-export">🤖 KI-Export …</button>
    </div>
    <div id="card-table"></div>
  </div>`;
  renderList();
}

function rowHtml(card) {
  const attempts = card.history.length;
  const last = lastAttempt(card);
  const checked = selected.has(card.id);
  return `<div class="ct-row${checked ? ' selected' : ''}" data-id="${card.id}">
    <div class="ct-check"><input type="checkbox" ${checked ? 'checked' : ''} aria-label="Karte auswählen" /></div>
    <div class="ct-sentence">
      <div class="de">${escapeHtml(card.German)}</div>
      ${card.tags.length ? `<div class="tags">${tagChips(card.tags)}</div>` : ''}
    </div>
    <div class="ct-attempts">${
      attempts
        ? `<b>${attempts} ${attempts === 1 ? 'Versuch' : 'Versuche'}</b><div class="muted small">${escapeHtml(ratingSummary(card))}</div>
           <div class="muted small">${errorCount(card)}× falsch · Ø ${fmtSeconds(avgThinkingTime(card))}</div>`
        : '<span class="muted">–</span>'
    }</div>
    <div class="ct-last">${
      last
        ? `${last.isExactMatch ? '✅' : '❌'}${last.inputMethod === 'dictated' ? ' 🎤' : ''} ${last.userInput ? `<span class="last-input">${renderUserInput(last.diffTokens ?? [])}</span>` : '<span class="muted">(keine Eingabe)</span>'}`
        : '<span class="muted">noch nicht geübt</span>'
    }</div>
    <div class="ct-due">${
      card.srs.state === 'new'
        ? '<span class="muted">neu</span>'
        : `${relativeDue(card.srs.dueDate)}<div class="muted small">${new Date(card.srs.dueDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</div>`
    }</div>
    <div class="ct-actions">
      <button class="icon-btn" data-row-action="details" title="🔍 Verlauf ansehen" aria-label="Verlauf ansehen">🔍</button>
      <button class="icon-btn" data-row-action="copy" title="📋 Einzel-Export (Verlauf kopieren)" aria-label="Einzel-Export">📋</button>
      <button class="icon-btn" data-row-action="edit" title="✏️ Bearbeiten" aria-label="Bearbeiten">✏️</button>
      <button class="icon-btn danger" data-row-action="delete" title="🗑️ Löschen" aria-label="Löschen">🗑️</button>
    </div>
  </div>`;
}

function renderList() {
  const all = store.cards();
  // Auswahl von inzwischen gelöschten Karten entfernen.
  const existing = new Set(all.map((c) => c.id));
  for (const id of selected) if (!existing.has(id)) selected.delete(id);

  const list = all.filter(matches).sort(SORTS[filters.sort][1]);
  visibleIds = list.map((c) => c.id);
  lastCheckedIndex = null;
  $('#list-count', root).textContent = list.length === all.length ? `${all.length} Karten` : `${list.length} von ${all.length} Karten`;
  const table = $('#card-table', root);
  if (!list.length) {
    table.innerHTML = `<div class="empty-state"><p>${all.length ? 'Keine Karte passt zu Suche und Filtern.' : 'Noch keine Karten angelegt.'}</p></div>`;
  } else {
    table.innerHTML = `<div class="card-table">
      <div class="ct-row ct-header">
        <div class="ct-check"><input type="checkbox" id="check-visible" aria-label="Alle sichtbaren auswählen" /></div>
        <div>Satz &amp; Tags</div><div>Versuche</div><div>Letzte Eingabe</div><div>Fällig</div><div class="ct-actions-head">Aktionen</div>
      </div>
      ${list.map(rowHtml).join('')}
    </div>`;
  }
  updateSelectionUi();
}

function updateSelectionUi() {
  const visibleSelected = visibleIds.filter((id) => selected.has(id)).length;
  const header = $('#check-visible', root);
  if (header) {
    header.checked = visibleIds.length > 0 && visibleSelected === visibleIds.length;
    header.indeterminate = visibleSelected > 0 && visibleSelected < visibleIds.length;
  }
  const hidden = selected.size - visibleSelected;
  $('#selection-count', root).textContent = selected.size
    ? `${selected.size} ausgewählt${hidden ? ` (${hidden} davon ausgeblendet)` : ''}`
    : '';
}

function setSelected(id, on) {
  if (on) selected.add(id);
  else selected.delete(id);
  const row = $(`.ct-row[data-id="${id}"]`, root);
  if (row) {
    row.classList.toggle('selected', on);
    $('input[type="checkbox"]', row).checked = on;
  }
}

function deleteCard(id) {
  const removed = store.deleteCard(id);
  if (!removed) return;
  selected.delete(id);
  toast('Karte gelöscht', { action: { label: 'Rückgängig', run: () => store.restoreCard(removed) } });
}

// ------------------------------------------------------------------ Import

const TEMPLATE = `[
  {
    "German": "Als ich am Gate ankam, stiegen die anderen Passagiere bereits ein.",
    "Hint": "Ablauf in der Vergangenheit",
    "English": "When I arrived at the gate, the other passengers [[were already boarding]].",
    "Trap": "When I arrived in the Gate, the other passangers already [[stiegen ein]].",
    "Pattern": "When + [Past Simple], [Subjekt] + [[was / were]] + [Verb-ing]",
    "Transfer1": "When I entered the clinic, the doctor [[was already waiting]].",
    "Transfer2": "",
    "Rule": "Eine Handlung, die gerade im Ablauf war, erfordert Past Continuous.",
    "Alternative1": "When I got to the gate, the other passengers were already getting on the plane.",
    "Alternative2": "",
    "tags": ["tenses", "past-continuous", "travel"]
  }
]`;

export function openImport() {
  const modal = openModal({
    title: 'Karten importieren',
    footer: `<button class="btn" data-action="file">Datei wählen …</button>
      <span class="spacer"></span>
      <button class="btn" data-action="cancel">Abbrechen</button>
      <button class="btn primary" data-action="import">Importieren <kbd>⌘↵</kbd></button>`,
  });
  modal.body.innerHTML = `
    <p class="muted" style="margin-top:0">JSON einfügen oder eine Datei wählen: ein Array von Karten oder ein Objekt mit <code>"cards"</code>
      (z. B. ein Export dieser App). Fehlende Felder werden ergänzt, Duplikate (gleicher deutscher + englischer Satz) übersprungen.
      Vorhandener Lernverlauf (<code>srs</code>, <code>history</code>) wird übernommen.</p>
    <textarea id="import-text" rows="12" spellcheck="false" style="font-family:var(--mono);font-size:12px" placeholder="[ { &quot;German&quot;: …, &quot;English&quot;: … } ]"></textarea>
    <details class="table-view" style="margin-top:12px"><summary>Vorlage anzeigen</summary>
      <div class="code" style="margin-top:8px">${escapeHtml(TEMPLATE)}</div>
      <button class="btn small" data-action="use-template" style="margin-top:8px">Vorlage einfügen</button>
    </details>`;
  const textarea = $('#import-text', modal.body);
  textarea.focus();

  const run = () => {
    const text = textarea.value.trim();
    if (!text) return toast('Nichts zum Importieren.', { error: true });
    try {
      const { added, duplicates, invalid } = store.importCards(text);
      const parts = [`${added} ${added === 1 ? 'Karte' : 'Karten'} importiert`];
      if (duplicates) parts.push(`${duplicates} Duplikate übersprungen`);
      if (invalid) parts.push(`${invalid} ungültig (Deutsch/English fehlt)`);
      toast(parts.join(' · '), { error: added === 0 });
      if (added) modal.close();
    } catch (err) {
      toast(err.message, { error: true });
    }
  };

  modal.el.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'cancel') modal.close();
    if (action === 'import') run();
    if (action === 'use-template') textarea.value = TEMPLATE;
    if (action === 'file') {
      const content = await window.api.importFile();
      if (content != null) textarea.value = content;
    }
  });
  modal.el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      run();
    }
  });
}

// ------------------------------------------------------------------ Lifecycle

export function mount(el) {
  root = el;
  root.addEventListener('input', (e) => {
    if (e.target.id === 'card-search') {
      filters.query = e.target.value.trim();
      renderList();
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'filter-status') filters.status = e.target.value;
    else if (e.target.id === 'filter-tag') filters.tag = e.target.value;
    else if (e.target.id === 'sort') filters.sort = e.target.value;
    else if (e.target.id === 'check-visible') {
      visibleIds.forEach((id) => setSelected(id, e.target.checked));
      return updateSelectionUi();
    } else return;
    renderList();
  });
  root.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    switch (action) {
      case 'new':
        return openEditor(null);
      case 'import':
        return openImport();
      case 'ai-export':
        return openAiExport({ selectedIds: [...selected] });
      case 'select-visible':
        visibleIds.forEach((id) => setSelected(id, true));
        return updateSelectionUi();
      case 'clear-selection':
        [...selected].forEach((id) => setSelected(id, false));
        return updateSelectionUi();
    }

    const row = e.target.closest('.ct-row[data-id]');
    if (!row) return;
    const id = row.dataset.id;

    // Checkbox: Shift-Klick wählt einen Bereich.
    if (e.target.matches('.ct-check input')) {
      const index = visibleIds.indexOf(id);
      const on = e.target.checked;
      if (e.shiftKey && lastCheckedIndex != null) {
        const [from, to] = [Math.min(index, lastCheckedIndex), Math.max(index, lastCheckedIndex)];
        visibleIds.slice(from, to + 1).forEach((rid) => setSelected(rid, on));
      } else {
        setSelected(id, on);
      }
      lastCheckedIndex = index;
      return updateSelectionUi();
    }

    switch (e.target.closest('[data-row-action]')?.dataset.rowAction) {
      case 'details':
        return openDetails(id);
      case 'copy':
        return copyCardHistory(id);
      case 'edit':
        return openEditor(id);
      case 'delete':
        return deleteCard(id);
      default:
        // Klick auf die Zeile selbst öffnet die Details.
        if (!e.target.closest('.ct-check')) openDetails(id);
    }
  });
}

export function activate() {
  active = true;
  renderShell();
}

export function deactivate() {
  active = false;
}

export function refresh() {
  if (!active) return;
  const search = $('#card-search', root);
  const hadFocus = document.activeElement === search;
  const scroll = root.scrollTop;
  renderShell();
  root.scrollTop = scroll;
  if (hadFocus) {
    const s = $('#card-search', root);
    s.focus();
    s.setSelectionRange(s.value.length, s.value.length);
  }
}

export function focusSearch() {
  $('#card-search', root)?.focus();
}

export function openExportForSelection() {
  openAiExport({ selectedIds: [...selected] });
}
