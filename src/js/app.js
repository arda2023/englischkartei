// Einstiegspunkt des Renderers: Navigation, globale Tastenkürzel, Menü-Befehle.

import * as store from './store.js';
import * as study from './study.js';
import * as cards from './cards.js';
import * as stats from './stats.js';
import * as vocab from './vocab.js';
import * as settings from './settings.js';
import { $, $$, toast, isModalOpen, closeModal } from './ui.js';
import { openEditor } from './editor.js';

const views = { study, cards, stats, vocab, settings };
const ORDER = ['study', 'cards', 'stats', 'vocab', 'settings'];
let currentView = null;

function show(name) {
  if (!views[name] || name === currentView) return;
  if (currentView) views[currentView].deactivate();
  currentView = name;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  views[name].activate();
}

function updateBadge() {
  const badge = $('#due-badge');
  const n = study.dueCount();
  badge.hidden = n === 0;
  badge.textContent = n > 999 ? '999+' : String(n);
}

let savedTimer = null;
function updateSaveStatus() {
  const el = $('#save-status');
  const state = store.getSaveState();
  clearTimeout(savedTimer);
  el.classList.toggle('error', state === 'error');
  if (state === 'saving') el.textContent = 'Speichert …';
  else if (state === 'error') el.textContent = '⚠ Speichern fehlgeschlagen';
  else if (state === 'saved') {
    el.textContent = '✓ Gespeichert';
    savedTimer = setTimeout(() => (el.textContent = ''), 1500);
  }
}

function runCommand(command) {
  switch (command) {
    case 'view-study':
    case 'view-cards':
    case 'view-stats':
    case 'view-vocab':
    case 'view-settings':
      closeModal();
      return show(command.slice(5));
    case 'new-card':
      return openEditor(null);
    case 'import':
      return cards.openImport();
    case 'export':
      return settings.exportBackup();
    case 'restore':
      return settings.restoreBackup();
    case 'ai-export':
      closeModal();
      return cards.openExportForSelection();
    case 'find':
      closeModal();
      show('cards');
      return cards.focusSearch();
    case 'undo': {
      const el = document.activeElement;
      if (el?.matches('input, textarea')) return document.execCommand('undo');
      if (isModalOpen() || currentView !== 'study') return;
      return study.undo();
    }
    case 'undo-rating':
      if (isModalOpen()) return;
      show('study');
      return study.undo();
  }
}

function onKeyDown(e) {
  if (e.key === 'Escape' && isModalOpen()) {
    e.preventDefault();
    closeModal();
    return;
  }
  if (e.metaKey && !e.shiftKey && !e.altKey && /^[1-5]$/.test(e.key)) {
    e.preventDefault();
    runCommand(`view-${ORDER[Number(e.key) - 1]}`);
    return;
  }
  if (isModalOpen()) return;
  if (currentView === 'study' && study.handleKey(e)) e.preventDefault();
  if (currentView === 'vocab' && vocab.handleKey(e)) e.preventDefault();
}

async function init() {
  study.mount($('#view-study'), { openImport: cards.openImport });
  cards.mount($('#view-cards'));
  stats.mount($('#view-stats'));
  vocab.mount($('#view-vocab'));
  settings.mount($('#view-settings'));

  $$('.tab').forEach((tab) => tab.addEventListener('click', () => show(tab.dataset.view)));
  document.addEventListener('keydown', onKeyDown);
  window.api.onCommand?.(runCommand);

  store.onChange((reason) => {
    if (reason === 'save-state') return updateSaveStatus();
    if (reason === 'save-error') {
      toast('Speichern fehlgeschlagen – Änderungen sind evtl. nicht auf der Platte!', { error: true, duration: 8000 });
      return;
    }
    updateBadge();
    if (reason === 'load') study.clearUndo();
    if (reason === 'attempt' || reason === 'settings' || reason === 'vocab') return; // die Lernansicht steuert sich selbst
    for (const [name, view] of Object.entries(views)) if (name !== 'settings') view.refresh();
  });

  try {
    await store.load();
  } catch (err) {
    console.error(err);
    toast(`Datenbank konnte nicht geladen werden: ${err.message}`, { error: true, duration: 10000 });
  }
  updateBadge();
  show('study');
  // Fälligkeiten ändern sich mit der Zeit – Badge regelmäßig aktualisieren.
  setInterval(updateBadge, 30000);
}

init();
