// Kleine DOM- und Formatierungs-Helfer, die alle Views gemeinsam nutzen.

import { escapeHtml } from '../lib/markup.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const STATE_LABELS = {
  new: 'Neu',
  learning: 'Lernen',
  relearning: 'Wieder lernen',
  review: 'Wiederholen',
};

export function statePill(state) {
  return `<span class="pill state-${state}">${STATE_LABELS[state] ?? state}</span>`;
}

export function ratingPill(rating) {
  return `<span class="pill rating-${escapeHtml(rating)}">${escapeHtml(rating)}</span>`;
}

export function tagChips(tags) {
  return tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join(' ');
}

/** Rendert gespeicherte diffTokens (aus dem Lernverlauf oder frisch berechnet). */
export function renderDiff(tokens) {
  return tokens
    .map((t) => {
      const text = escapeHtml(t.text);
      const expected = escapeHtml(t.expected ?? '');
      switch (t.status) {
        case 'ok':
          return `<span class="tok-ok">${text}</span>`;
        case 'wrong':
          return `<span><span class="tok-wrong">${text}</span> <span class="tok-expected">${expected}</span></span>`;
        case 'typo':
          return `<span><span class="tok-typo" title="Tippfehler – richtig: ${expected}">${text}</span> <span class="tok-expected">${expected}</span></span>`;
        case 'missing':
          return `<span class="tok-missing" title="fehlt">${expected}</span>`;
        case 'extra':
          return `<span class="tok-extra" title="überflüssig">${text}</span>`;
        default:
          return `<span>${text}</span>`;
      }
    })
    .join(' ');
}

/**
 * Kompakte Darstellung der Nutzereingabe: nur die Fehler rot markiert (Tooltip zeigt das Richtige),
 * fehlende Wörter als kleines ‸.
 */
export function renderUserInput(tokens) {
  return tokens
    .map((t) => {
      const text = escapeHtml(t.text);
      const expected = escapeHtml(t.expected ?? '');
      switch (t.status) {
        case 'ok':
          return text;
        case 'wrong':
          return `<span class="err" title="richtig: ${expected}">${text}</span>`;
        case 'typo':
          return `<span class="err typo" title="Tippfehler – richtig: ${expected}">${text}</span>`;
        case 'extra':
          return `<span class="err" title="überflüssig">${text}</span>`;
        case 'missing':
          return `<span class="err-missing" title="fehlt: ${expected}">‸</span>`;
        default:
          return text;
      }
    })
    .join(' ');
}

/** Kopiert Text über den Main-Prozess in die Zwischenablage. */
export async function copyToClipboard(text, message = 'Kopiert!') {
  try {
    await window.api.copyText(text);
    toast(message);
    return true;
  } catch (err) {
    toast(`Kopieren fehlgeschlagen: ${err.message}`, { error: true });
    return false;
  }
}

// ------------------------------------------------------------------ Formatierung

const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

export function fmtSeconds(s) {
  if (s == null || Number.isNaN(s)) return '–';
  if (s < 60) return `${nf1.format(s)} s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')} min`;
}

export function fmtPercent(ratio) {
  if (ratio == null || Number.isNaN(ratio)) return '–';
  return `${nf0.format(ratio * 100)} %`;
}

export function fmtNumber(n) {
  return nf0.format(n);
}

export function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** "fällig", "in 5 Min.", "morgen", "in 12 Tagen" */
export function relativeDue(iso, now = new Date()) {
  const due = new Date(iso);
  const diffMs = due - now;
  if (diffMs <= 0) return 'fällig';
  const minutes = Math.ceil(diffMs / 60000);
  if (minutes < 60) return `in ${minutes} Min.`;
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
  if (days <= 0) return `in ${Math.round(minutes / 60)} Std.`;
  if (days === 1) return 'morgen';
  if (days < 60) return `in ${days} Tagen`;
  return due.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ------------------------------------------------------------------ Toasts

export function toast(message, { error = false, action = null, duration = 3200 } = {}) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      action.run();
      el.remove();
    });
    el.appendChild(btn);
  }
  root.appendChild(el);
  setTimeout(() => el.remove(), action ? duration * 2 : duration);
}

// ------------------------------------------------------------------ Modals

let activeModal = null;

export function isModalOpen() {
  return activeModal != null;
}

/**
 * Öffnet einen Dialog. `render(body)` füllt den Inhalt; der Rückgabewert hat close().
 */
export function openModal({ title, headerExtra = '', footer = '', onClose, wide = false }) {
  closeModal();
  const root = $('#modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" ${wide ? 'style="width:min(900px,100%)"' : ''}>
      <div class="modal-header"><h2>${escapeHtml(title)}</h2>${headerExtra}
        <button class="btn ghost" data-close title="Schließen (Esc)">✕</button></div>
      <div class="modal-body"></div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>`;
  root.appendChild(backdrop);
  const previousFocus = document.activeElement;
  const modal = {
    el: backdrop.querySelector('.modal'),
    body: backdrop.querySelector('.modal-body'),
    close() {
      if (activeModal !== modal) return;
      activeModal = null;
      backdrop.remove();
      onClose?.();
      previousFocus?.focus?.();
    },
  };
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) modal.close();
  });
  backdrop.querySelector('[data-close]').addEventListener('click', () => modal.close());
  activeModal = modal;
  return modal;
}

export function closeModal() {
  activeModal?.close();
}

// ------------------------------------------------------------------ Tooltip

export function showTooltip(html, x, y) {
  const tip = $('#tooltip');
  tip.innerHTML = html;
  tip.hidden = false;
  const rect = tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - rect.width - 8, Math.max(8, x - rect.width / 2));
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(8, y - rect.height - 10)}px`;
}

export function hideTooltip() {
  $('#tooltip').hidden = true;
}

/** Textarea wächst mit dem Inhalt. */
export function autoGrow(textarea) {
  const fit = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  };
  textarea.addEventListener('input', fit);
  requestAnimationFrame(fit);
}
