// Vokabel-Speed-Drill: Deutsches Wort → auflösen → richtig/falsch.
// Wörter aus allen Kategorien werden gemischt, bekannte Wörter lassen sich dauerhaft löschen.

import * as store from './store.js';
import { escapeHtml } from '../lib/markup.js';
import { CATEGORY_LABELS, MASTER_STREAK, FAST_SECONDS, pickNext, countByCategory } from '../lib/vocab.js';
import { toast, fmtNumber, fmtPercent, isModalOpen } from './ui.js';

let root;
let active = false;
let ready = false;
let current = null; // { id, revealed }
let category = 'all';
let last = { lastId: null, lastCategory: null };
const session = { right: 0, wrong: 0, mastered: 0 };

const items = () => store.vocab()?.items ?? [];
const removed = () => store.vocab()?.removed ?? [];
const currentItem = () => (current ? items().find((i) => i.id === current.id) : null);

function next() {
  const item = pickNext(items(), { category, ...last });
  current = item ? { id: item.id, revealed: false, shownAt: performance.now(), revealSeconds: null } : null;
  render();
}

function reveal() {
  if (!current || current.revealed) return;
  current.revealed = true;
  current.revealSeconds = (performance.now() - current.shownAt) / 1000;
  render();
}

function answer(correct) {
  const item = currentItem();
  if (!item || !current.revealed) return;
  const mastered = store.recordVocabAnswer(item.id, correct, current.revealSeconds);
  session[correct ? 'right' : 'wrong']++;
  last = { lastId: item.id, lastCategory: item.category };
  if (mastered) {
    session.mastered++;
    toast(`„${item.de}“ gelernt – ${MASTER_STREAK}× schnell richtig, wird nicht mehr angezeigt`, {
      action: {
        label: 'Rückgängig',
        run: () => {
          store.restoreVocab(item.id);
          render();
        },
      },
    });
  }
  next();
}

function removeCurrent() {
  const item = currentItem();
  if (!item) return;
  const removedItem = store.removeVocab(item.id);
  if (!removedItem) return;
  toast(`„${item.de}“ dauerhaft gelöscht`, {
    action: {
      label: 'Rückgängig',
      run: () => {
        store.restoreVocab(item.id);
        render();
      },
    },
  });
  next();
}

// ------------------------------------------------------------------ Rendering

function categoryOptions() {
  const counts = countByCategory(items());
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const opts = [['all', `Alle Kategorien (Mix) · ${fmtNumber(all)}`]];
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) opts.push([key, `${label} · ${fmtNumber(counts[key] ?? 0)}`]);
  return opts.map(([v, l]) => `<option value="${v}" ${v === category ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('');
}

function removedList() {
  const list = removed();
  if (!list.length) return '';
  return `<details class="table-view removed-list">
    <summary>Gelöschte Wörter (${fmtNumber(list.length)})</summary>
    <div class="removed-actions"><button class="btn small" data-action="restore-all">Alle wiederherstellen</button></div>
    <table class="data"><tbody>${[...list]
      .reverse()
      .map(
        (w) => `<tr><td>${escapeHtml(w.de)}</td><td>${escapeHtml(w.en)}</td>
          <td class="muted">${escapeHtml(CATEGORY_LABELS[w.category] ?? w.category)}${w.removedReason === 'mastered' ? ' · gelernt' : ''}</td>
          <td class="num"><button class="btn small ghost" data-restore="${escapeHtml(w.id)}">Wiederherstellen</button></td></tr>`,
      )
      .join('')}</tbody></table>
  </details>`;
}

function removeButton() {
  return `<button class="remove-btn" data-action="remove" title="Dauerhaft aus dem Training löschen (↓ oder ⌘⌫)"><kbd>↓</kbd><span class="label">🗑️ Kenne ich</span><span class="sub">dauerhaft löschen</span></button>`;
}

function render() {
  if (!root || !active) return;
  if (!ready) {
    root.innerHTML = '<div class="container"><p class="muted">Vokabeln werden geladen …</p></div>';
    return;
  }
  const item = currentItem();
  const total = items().length;
  const answered = session.right + session.wrong;

  const header = `<div class="study-header">
      <div class="counts">
        <span title="Noch im Training"><b>${fmtNumber(total)}</b>Wörter</span>
        <span class="c-review"><b>${session.right}</b>Richtig</span>
        <span class="c-learn"><b>${session.wrong}</b>Falsch</span>
        ${session.mastered ? `<span title="In dieser Sitzung automatisch gelernt"><b>${session.mastered}</b>Gelernt</span>` : ''}
        ${answered ? `<span>${fmtPercent(session.right / answered)}</span>` : ''}
      </div>
      <select id="vocab-category" title="Kategorie wählen">${categoryOptions()}</select>
    </div>`;

  let body;
  if (!item) {
    body = `<div class="empty-state">
        <div class="big">${total ? '🎉' : '✅'}</div>
        <h2>${total ? 'Keine Wörter in dieser Kategorie' : 'Alle Wörter gelöscht'}</h2>
        <p>${total ? 'Wähle oben eine andere Kategorie.' : 'Du kennst alle Wörter – oder stelle gelöschte Wörter unten wieder her.'}</p>
      </div>`;
  } else {
    body = `<div class="card vocab-card">
        <div class="card-meta">
          <span class="chip">${escapeHtml(CATEGORY_LABELS[item.category] ?? item.category)}</span>
        </div>
        <div class="vocab-word">${escapeHtml(item.de)}</div>
        <div class="vocab-answer ${current.revealed ? '' : 'hidden'}">${current.revealed ? escapeHtml(item.en) : '&nbsp;'}</div>
        ${
          current.revealed
            ? `<div class="vocab-buttons three">
                <button class="rate" data-action="wrong" data-rating="Nochmal"><kbd>←</kbd><span class="label">Falsch</span></button>
                ${removeButton()}
                <button class="rate" data-action="right" data-rating="Gut"><kbd>→</kbd><span class="label">Richtig</span></button>
              </div>`
            : `<div class="vocab-buttons single"><button class="btn primary big-btn" data-action="reveal">Auflösen <kbd>Leertaste</kbd></button>
                ${removeButton()}</div>`
        }
        <div class="muted small vocab-stats">${
          item.right || item.wrong ? `Bisher: ${item.right}× richtig · ${item.wrong}× falsch` : 'Neues Wort'
        } · schnell richtig (≤ ${FAST_SECONDS} s): <b>${item.fastStreak || 0}/${MASTER_STREAK}</b></div>
      </div>`;
  }
  root.innerHTML = `<div class="container narrow">${header}${body}${removedList()}</div>`;
}

// ------------------------------------------------------------------ Lifecycle

export function mount(el) {
  root = el;
  root.addEventListener('change', (e) => {
    if (e.target.id !== 'vocab-category') return;
    category = e.target.value;
    last = { lastId: null, lastCategory: null };
    next();
  });
  root.addEventListener('click', (e) => {
    const restoreId = e.target.closest('[data-restore]')?.dataset.restore;
    if (restoreId) {
      store.restoreVocab(restoreId);
      if (!current) next();
      else render();
      return;
    }
    switch (e.target.closest('[data-action]')?.dataset.action) {
      case 'reveal':
        return reveal();
      case 'right':
        return answer(true);
      case 'wrong':
        return answer(false);
      case 'remove':
        return removeCurrent();
      case 'restore-all':
        store.restoreAllVocab();
        toast('Alle Wörter wiederhergestellt');
        return current ? render() : next();
    }
  });
}

export async function activate() {
  active = true;
  render();
  if (!ready) {
    try {
      await store.ensureVocab();
      ready = true;
    } catch (err) {
      toast(`Vokabeln konnten nicht geladen werden: ${err.message}`, { error: true });
      return;
    }
  }
  if (!currentItem()) next();
  else render();
}

export function deactivate() {
  active = false;
}

export function refresh() {
  if (!active || !ready) return;
  if (!currentItem()) next();
}

export function handleKey(e) {
  if (!active || !ready || isModalOpen() || e.target.matches?.('input, textarea, select')) return false;
  if (e.key === 'Backspace' && e.metaKey) {
    removeCurrent();
    return true;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.repeat) return e.key === ' ' || e.key.startsWith('Arrow'); // gehaltene Taste löst nichts aus
  if (e.key === 'ArrowDown') {
    if (!e.repeat) removeCurrent();
    return true;
  }
  if (current && !current.revealed && (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight')) {
    reveal();
    return true;
  }
  if (current?.revealed) {
    if (e.key === 'ArrowLeft' || e.key === '1') {
      answer(false);
      return true;
    }
    if (e.key === 'ArrowRight' || e.key === '2') {
      answer(true);
      return true;
    }
  }
  return false;
}
