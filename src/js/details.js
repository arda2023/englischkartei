// Detail-Modal einer Karte: alle Felder, SRS-Zustand und vollständige Timeline der Versuche.

import * as store from './store.js';
import { escapeHtml, renderMarked } from '../lib/markup.js';
import { RATINGS } from '../lib/srs.js';
import { cardHistoryMarkdown, ratingCounts, errorCount, avgThinkingTime, fmtSpan } from '../lib/export.js';
import { openModal, renderDiff, ratingPill, statePill, tagChips, fmtSeconds, fmtPercent, relativeDue, fmtDateTime, copyToClipboard } from './ui.js';
import { openEditor } from './editor.js';

/** Verlauf einer Karte als Markdown kopieren (optional inkl. laufendem, noch unbewertetem Versuch). */
export function copyCardHistory(cardId, pendingAttempt = null) {
  const card = store.getCard(cardId);
  if (!card) return;
  if (!card.history.length && !pendingAttempt) {
    copyToClipboard(cardHistoryMarkdown(card), 'Verlauf kopiert! (noch keine Versuche)');
    return;
  }
  copyToClipboard(cardHistoryMarkdown(card, { pendingAttempt }), 'Verlauf kopiert!');
}

export function ratingSummary(card) {
  const counts = ratingCounts(card);
  return RATINGS.filter((r) => counts[r])
    .map((r) => `${counts[r]}× ${r}`)
    .join(', ');
}

function dueText(iso) {
  const rel = relativeDue(iso);
  return rel === 'fällig' ? 'jetzt fällig' : `fällig ${rel}`;
}

function field(label, html) {
  return html ? `<div class="detail-field"><h3>${label}</h3><div>${html}</div></div>` : '';
}

function timeline(card) {
  if (!card.history.length) return '<p class="muted">Noch keine Versuche.</p>';
  return `<ol class="timeline">${card.history
    .map((a, i) => {
      const weekday = new Date(a.shownAt).toLocaleDateString('de-DE', { weekday: 'short' });
      return `<li class="tl-item rating-${escapeHtml(a.rating)}">
        <div class="tl-head">
          <span class="tl-num">${i + 1}.</span>
          <span>${weekday}, ${escapeHtml(fmtSpan(a.shownAt, a.submittedAt))}</span>
          <span class="muted">· ${fmtSeconds(a.thinkingTimeSeconds)} Denkzeit</span>
          <span class="spacer"></span>
          <span>${a.isExactMatch ? '✅' : '❌'}</span>
          ${ratingPill(a.rating)}
          <span class="muted">→ ${escapeHtml(a.intervalAfterText ?? '')}</span>
        </div>
        <div class="diff">${a.userInput ? renderDiff(a.diffTokens ?? []) : '<span class="muted">(keine Eingabe – „Weiß nicht“)</span>'}</div>
        ${!a.isExactMatch && a.matchedTarget ? `<div class="tl-target">Verglichen mit: ${escapeHtml(a.matchedTarget)}</div>` : ''}
      </li>`;
    })
    .join('')}</ol>`;
}

export function openDetails(cardId) {
  const card = store.getCard(cardId);
  if (!card) return;
  const srs = card.srs;
  const attempts = card.history.length;
  const exact = attempts - errorCount(card);

  const modal = openModal({
    title: 'Kartendetails & Verlauf',
    wide: true,
    footer: `
      <button class="btn" data-action="copy">📋 Verlauf kopieren</button>
      <span class="spacer"></span>
      <button class="btn" data-action="edit">✏️ Bearbeiten</button>
      <button class="btn primary" data-action="close">Schließen</button>`,
  });

  modal.body.innerHTML = `
    <div class="german" style="font-size:20px">${escapeHtml(card.German)}</div>
    <div class="solution" style="margin-top:6px">${renderMarked(card.English)}</div>
    ${card.tags.length ? `<div style="margin-top:10px">${tagChips(card.tags)}</div>` : ''}

    <div class="detail-grid">
      ${field('💡 Hinweis', escapeHtml(card.Hint))}
      ${field('🧩 Muster', card.Pattern ? `<span class="pattern-text">${renderMarked(card.Pattern, 'pattern')}</span>` : '')}
      ${field('📘 Regel', renderMarked(card.Rule))}
      ${field('⚠️ Typische Falle', renderMarked(card.Trap, 'trap'))}
      ${field('🔁 Transfer', [card.Transfer1, card.Transfer2].filter(Boolean).map((t) => renderMarked(t)).join('<br>'))}
      ${field('↔️ Alternativen', [card.Alternative1, card.Alternative2].filter(Boolean).map((t) => escapeHtml(t)).join('<br>'))}
    </div>

    <div class="tiles detail-tiles">
      <div class="tile"><div class="label">Status</div><div class="value small-value">${statePill(srs.state)}</div>
        <div class="sub">${srs.state === 'new' ? 'noch nicht gelernt' : dueText(srs.dueDate)}</div></div>
      <div class="tile"><div class="label">Intervall</div><div class="value">${srs.intervalDays === 1 ? '1 Tag' : `${srs.intervalDays} Tage`}</div>
        <div class="sub">Ease ${srs.easeFactor.toFixed(2)}</div></div>
      <div class="tile"><div class="label">Versuche</div><div class="value">${attempts}</div>
        <div class="sub">${attempts ? `${fmtPercent(exact / attempts)} exakt` : '–'}</div></div>
      <div class="tile"><div class="label">Ø Denkzeit</div><div class="value">${attempts ? fmtSeconds(avgThinkingTime(card)) : '–'}</div>
        <div class="sub">Lapses: ${srs.lapses}</div></div>
    </div>
    <p class="muted small">Erstellt am ${fmtDateTime(card.createdAt)}${attempts ? ` · Bewertungen: ${ratingSummary(card)}` : ''}</p>

    <div class="section-head" style="margin-top:18px"><h2>Timeline (${attempts} ${attempts === 1 ? 'Versuch' : 'Versuche'})</h2></div>
    ${timeline(card)}`;

  modal.el.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'copy') copyCardHistory(card.id);
    if (action === 'close') modal.close();
    if (action === 'edit') {
      modal.close();
      openEditor(card.id, { onSaved: () => openDetails(card.id) });
    }
  });
  return modal;
}
