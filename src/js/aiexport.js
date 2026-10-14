// KI-Export-Manager: Umfang, Zeitraum und Kompression wählen – mit Live-Größenanzeige,
// damit der Export in ein KI-Kontextfenster passt.

import * as store from './store.js';
import { escapeHtml } from '../lib/markup.js';
import {
  SCOPES,
  COMPRESSIONS,
  SIZE_WARNING_CHARS,
  buildSelection,
  describeFilter,
  toMarkdown,
  toJson,
  estimateTokens,
} from '../lib/export.js';
import { $, openModal, fmtNumber, copyToClipboard, toast, dayKey } from './ui.js';

// Letzte Einstellungen für die Sitzung merken (Umfang wird jedes Mal neu bestimmt).
const remembered = { period: 'all', compression: 'smart' };
const PREVIEW_CHARS = 6000;
// Als Array, weil Objekte Zahlen-Schlüssel (7, 30) immer vor „all“ einsortieren würden.
const PERIOD_OPTIONS = [
  ['all', 'Alle Zeiten'],
  ['7', 'Nur Versuche der letzten 7 Tage'],
  ['30', 'Nur Versuche der letzten 30 Tage'],
];

function radioGroup(name, options, value, disabled = {}) {
  return (Array.isArray(options) ? options : Object.entries(options))
    .map(
      ([key, label]) => `<label class="radio${disabled[key] ? ' disabled' : ''}">
        <input type="radio" name="${name}" value="${key}" ${key === value ? 'checked' : ''} ${disabled[key] ? 'disabled' : ''} />
        <span>${escapeHtml(label)}</span></label>`,
    )
    .join('');
}

export function openAiExport({ selectedIds = [] } = {}) {
  const state = {
    scope: selectedIds.length ? 'selected' : 'problems',
    period: remembered.period,
    compression: remembered.compression,
  };
  let result = null;

  const modal = openModal({
    title: '🤖 KI-Export konfigurieren',
    wide: true,
    footer: `
      <div class="export-actions">
        <div class="export-format">
          <span class="muted small">Format A · Kompakt-Markdown</span>
          <div class="btn-row">
            <button class="btn primary" data-action="md-copy">📋 In Zwischenablage kopieren</button>
            <button class="btn" data-action="md-save">Als Datei speichern …</button>
          </div>
        </div>
        <div class="export-format">
          <span class="muted small">Format B · Vollständiges JSON</span>
          <div class="btn-row">
            <button class="btn" data-action="json-copy">In Zwischenablage kopieren</button>
            <button class="btn" data-action="json-save">Als Datei speichern …</button>
          </div>
        </div>
      </div>`,
  });

  const selectedLabel = `${SCOPES.selected} (${selectedIds.length} angehakt)`;
  modal.body.innerHTML = `
    <div class="export-grid">
      <fieldset><legend>1. Umfang</legend>
        ${radioGroup('scope', { ...SCOPES, selected: selectedLabel }, state.scope, { selected: !selectedIds.length })}
      </fieldset>
      <fieldset><legend>2. Zeitraum</legend>
        ${radioGroup('period', PERIOD_OPTIONS, state.period)}
      </fieldset>
      <fieldset><legend>3. Kompression pro Karte</legend>
        ${radioGroup('compression', COMPRESSIONS, state.compression)}
      </fieldset>
    </div>
    <div class="export-size" id="export-size"></div>
    <details class="table-view export-preview"><summary>Vorschau (Markdown)</summary><pre class="code" id="export-preview"></pre></details>`;

  const recompute = () => {
    const now = new Date();
    const selection = buildSelection(store.cards(), { ...state, selectedIds, now });
    const filterText = describeFilter({ ...state, selectedCount: selectedIds.length });
    const markdown = toMarkdown(selection, { filterText, now });
    const json = toJson(selection, { filter: { ...state, description: filterText }, now });
    result = { selection, markdown, json };

    const empty = selection.entries.length === 0;
    const mdTooBig = markdown.length > SIZE_WARNING_CHARS;
    const jsonTooBig = json.length > SIZE_WARNING_CHARS;
    $('#export-size', modal.body).innerHTML = `
      <div class="export-size-main">Ausgewählt: <b>${fmtNumber(selection.entries.length)}</b> Karten mit insgesamt
        <b>${fmtNumber(selection.attemptCount)}</b> Versuchen
        (~${fmtNumber(markdown.length)} Zeichen / geschätzt ~${fmtNumber(estimateTokens(markdown))} Tokens)</div>
      <div class="muted small">JSON: ~${fmtNumber(json.length)} Zeichen / ~${fmtNumber(estimateTokens(json))} Tokens${jsonTooBig ? ' · ⚠️ über 40.000 Zeichen' : ''}</div>
      ${empty ? '<div class="export-warning">Keine Karten für diese Auswahl – ändere Umfang oder Zeitraum.</div>' : ''}
      ${mdTooBig ? `<div class="export-warning">⚠️ Der Markdown-Export ist größer als ${fmtNumber(SIZE_WARNING_CHARS)} Zeichen und könnte das Kontextfenster der KI sprengen. Wähle einen kürzeren Zeitraum, eine stärkere Kompression oder weniger Karten.</div>` : ''}`;
    $('#export-preview', modal.body).textContent =
      markdown.length > PREVIEW_CHARS ? `${markdown.slice(0, PREVIEW_CHARS)}\n… (${fmtNumber(markdown.length - PREVIEW_CHARS)} weitere Zeichen)` : markdown;
    modal.el.querySelectorAll('.export-actions .btn').forEach((b) => {
      b.disabled = empty;
    });
  };

  modal.body.addEventListener('change', (e) => {
    if (!(e.target.name in state)) return;
    state[e.target.name] = e.target.value;
    if (e.target.name !== 'scope') remembered[e.target.name] = e.target.value;
    recompute();
  });

  modal.el.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action || !result) return;
    const stamp = dayKey(new Date());
    if (action === 'md-copy') copyToClipboard(result.markdown, 'Markdown-Export kopiert!');
    if (action === 'json-copy') copyToClipboard(result.json, 'JSON-Export kopiert!');
    if (action === 'md-save' || action === 'json-save') {
      const isMd = action === 'md-save';
      const path = await window.api.exportFile(
        isMd ? result.markdown : result.json,
        `englisch-lernverlauf-${stamp}.${isMd ? 'md' : 'json'}`,
      );
      if (path) toast('Export gespeichert');
    }
  });

  recompute();
  return modal;
}
