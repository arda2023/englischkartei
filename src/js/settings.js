// Einstellungen, Datenverwaltung und Tastenkürzel.

import * as store from './store.js';
import { escapeHtml } from '../lib/markup.js';
import { toast, dayKey } from './ui.js';
import { openImport } from './cards.js';

let root;
let active = false;
let dbPath = '';

const SHORTCUTS = [
  ['↵', 'Antwort prüfen'],
  ['⌘ ↵', 'Lösung ohne Antwort aufdecken („Weiß nicht“)'],
  ['⌘ ⇧ H', 'Hinweis zeigen'],
  ['1 – 4', 'Nochmal · Schwer · Gut · Einfach'],
  ['↵ / Leertaste', 'Vorgeschlagene Bewertung übernehmen'],
  ['E', 'Aktuelle Karte bearbeiten'],
  ['⌘ Z', 'Letzte Bewertung rückgängig (außerhalb von Textfeldern)'],
  ['⌘ ⌥ Z', 'Letzte Bewertung rückgängig (immer)'],
  ['⌘ 1 – 4', 'Lernen · Karten · Statistik · Einstellungen'],
  ['⌘ N', 'Neue Karte'],
  ['⌘ F', 'Karten durchsuchen'],
  ['⌘ ↵', 'Im Dialog: speichern'],
  ['⌘ ⇧ K', 'KI-Export (mit aktueller Auswahl)'],
  ['⇧ Klick', 'Bereich in der Kartenverwaltung auswählen'],
  ['Esc', 'Dialog schließen'],
];

export async function exportBackup() {
  const path = await window.api.exportFile(store.exportJson(), `database-backup-${dayKey(new Date())}.json`);
  if (path) toast('Voll-Backup exportiert');
}

export async function restoreBackup() {
  try {
    const result = await window.api.restoreDb();
    if (!result) return;
    if (result.error) return toast(result.error, { error: true, duration: 6000 });
    store.replaceAll(result.db);
    toast(`Backup wiederhergestellt · vorheriger Stand gesichert als ${result.safetyName}`, { duration: 6000 });
  } catch (err) {
    toast(`Wiederherstellen fehlgeschlagen: ${err.message}`, { error: true, duration: 6000 });
  }
}

function render() {
  const s = store.settings();
  root.innerHTML = `<div class="container">
    <div class="section-head"><h2>Lernen</h2></div>
    <div class="settings-group">
      <div class="setting">
        <div class="text"><div>Neue Karten pro Tag</div>
          <div class="desc">Wie viele noch nie gelernte Karten pro Tag in die Abfrage kommen.</div></div>
        <input type="number" id="new-per-day" min="0" max="999" value="${s.newPerDay}" />
      </div>
      <div class="setting">
        <div class="text"><div>Hinweis automatisch anzeigen</div>
          <div class="desc">Sonst erscheint der Hinweis erst auf Klick bzw. mit ⌘⇧H.</div></div>
        <label class="switch"><input type="checkbox" id="auto-hint" ${s.autoShowHint ? 'checked' : ''} /><span></span></label>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Daten</h2></div>
      <div class="settings-group">
        <div class="setting">
          <div class="text"><div>Speicherort</div>
            <div class="desc" style="font-family:var(--mono);word-break:break-all">${escapeHtml(dbPath)}</div>
            <div class="desc">Jede Änderung wird sofort atomar gespeichert (.tmp-Datei + Umbenennen). Beim Start wird zusätzlich
              <code>database.backup.json</code> angelegt.</div></div>
          <button class="btn" data-action="reveal">Im Finder zeigen</button>
        </div>
        <div class="setting">
          <div class="text"><div>Voll-Backup exportieren (database.json)</div>
            <div class="desc">Komplette Datenbank (Karten, Lernverlauf, Einstellungen) als JSON-Datei sichern.</div></div>
          <button class="btn" data-action="export">Voll-Backup exportieren …</button>
        </div>
        <div class="setting">
          <div class="text"><div>Backup wiederherstellen</div>
            <div class="desc">Ersetzt alle aktuellen Daten durch ein Backup. Vorher wird der aktuelle Stand automatisch als
              <code>database.before-restore-….json</code> im data-Ordner gesichert.</div></div>
          <button class="btn danger" data-action="restore">Backup wiederherstellen …</button>
        </div>
        <div class="setting">
          <div class="text"><div>Karten importieren</div>
            <div class="desc">JSON-Datei oder eingefügter Text. Duplikate werden übersprungen.</div></div>
          <button class="btn" data-action="import">Importieren …</button>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Tastenkürzel</h2></div>
      <div class="panel shortcuts">
        ${SHORTCUTS.map(([k, d]) => `<span>${k
          .split(' ')
          .map((p) => (p === '–' || p === '/' ? `<span class="muted">${p}</span>` : `<kbd>${p}</kbd>`))
          .join(' ')}</span><span>${d}</span>`).join('')}
      </div>
    </div>
  </div>`;
}

export function mount(el) {
  root = el;
  window.api.dbPath().then((p) => {
    dbPath = p;
    if (active) render();
  });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'new-per-day') {
      const n = Math.max(0, Math.min(999, Math.round(Number(e.target.value) || 0)));
      e.target.value = n;
      store.updateSettings({ newPerDay: n });
      toast('Gespeichert');
    }
    if (e.target.id === 'auto-hint') {
      store.updateSettings({ autoShowHint: e.target.checked });
    }
  });
  root.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'reveal') window.api.revealDb();
    if (action === 'export') exportBackup();
    if (action === 'restore') restoreBackup();
    if (action === 'import') openImport();
  });
}

export function activate() {
  active = true;
  render();
}

export function deactivate() {
  active = false;
}

export function refresh() {
  /* Einstellungen ändern sich nur hier – kein Neu-Rendern nötig (Fokus bleibt erhalten). */
}
