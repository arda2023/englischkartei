// Lernansicht: Deutsch → aktiv ins Englische übersetzen → Wort-Diff → Bewertung.

import * as store from './store.js';
import { compareAnswer, suggestRating } from '../lib/diff.js';
import { RATINGS, schedule, previewIntervals, formatInterval } from '../lib/srs.js';
import { escapeHtml, renderMarked } from '../lib/markup.js';
import { $, renderDiff, statePill, tagChips, fmtSeconds, fmtPercent, relativeDue, startOfDay, toast, autoGrow } from './ui.js';
import { openEditor } from './editor.js';
import { copyCardHistory } from './details.js';

let root;
let current = null; // { cardId, phase: 'question'|'answer', shownAt, submittedAt, hintShown, result, suggested, previews, answeredAt }
let mode = 'idle'; // 'question' | 'answer' | 'waiting' | 'done' | 'empty'
let lastCardId = null;
let undoStack = [];
let session = freshSession();
let timer = null;
let waitTimer = null;
let active = false;

function freshSession() {
  return { reviewed: 0, exact: 0, times: [], extraNew: 0, startedAt: new Date() };
}

// ------------------------------------------------------------------ Warteschlange

function newIntroducedToday(now = new Date()) {
  const today = startOfDay(now).getTime();
  let n = 0;
  for (const card of store.cards()) {
    for (const a of card.history) {
      if (a.stateBefore === 'new' && Date.parse(a.submittedAt) >= today) n++;
    }
  }
  return n;
}

function buildQueues(now = new Date()) {
  const learn = [];
  const review = [];
  const fresh = [];
  const upcoming = [];
  for (const card of store.cards()) {
    const { state, dueDate } = card.srs;
    const due = Date.parse(dueDate);
    if (state === 'new') fresh.push(card);
    else if (due <= now) (state === 'review' ? review : learn).push(card);
    else if (state !== 'review') upcoming.push(card);
  }
  const byDue = (a, b) => Date.parse(a.srs.dueDate) - Date.parse(b.srs.dueDate);
  learn.sort(byDue);
  review.sort(byDue);
  upcoming.sort(byDue);
  fresh.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const limit = Math.max(0, store.settings().newPerDay - newIntroducedToday(now) + session.extraNew);
  return { learn, review, fresh: fresh.slice(0, limit), freshTotal: fresh.length, upcoming };
}

export function dueCount() {
  const q = buildQueues();
  return q.learn.length + q.review.length + q.fresh.length;
}

function pickNext(now = new Date()) {
  const q = buildQueues(now);
  // Lernkarten zuerst, dann Wiederholungen – jede 4. Karte eine neue, falls vorhanden.
  const order = [];
  order.push(...q.learn);
  const preferNew = q.fresh.length && (session.reviewed % 4 === 3 || !q.review.length);
  if (preferNew) order.push(...q.fresh, ...q.review);
  else order.push(...q.review, ...q.fresh);
  const pick = order.find((c) => c.id !== lastCardId) ?? order[0];
  return { card: pick ?? null, queues: q };
}

// ------------------------------------------------------------------ Ablauf

function next() {
  stopTimers();
  const { card, queues } = pickNext();
  if (card) {
    current = {
      cardId: card.id,
      shownAt: new Date(),
      hintShown: store.settings().autoShowHint,
      draft: '',
    };
    mode = 'question';
  } else {
    current = null;
    if (!store.cards().length) mode = 'empty';
    else if (queues.upcoming.length) mode = 'waiting';
    else mode = 'done';
  }
  render();
}

function currentCard() {
  return current ? store.getCard(current.cardId) : null;
}

function submit(forceReveal = false) {
  const card = currentCard();
  if (!card || mode !== 'question') return;
  const input = $('#answer-input', root)?.value.trim() ?? '';
  if (!input && !forceReveal) {
    $('#answer-input', root)?.focus();
    return;
  }
  const submittedAt = new Date();
  const result = compareAnswer(input, [card.English, card.Alternative1, card.Alternative2]);
  current = {
    ...current,
    input,
    submittedAt,
    thinkingTimeSeconds: Math.round(((submittedAt - current.shownAt) / 1000) * 10) / 10,
    result,
    suggested: input ? suggestRating(result) : 'Nochmal',
    previews: previewIntervals(card.srs, submittedAt),
    answeredAt: performance.now(),
  };
  mode = 'answer';
  stopTimers();
  render();
}

function rate(rating) {
  const card = currentCard();
  if (!card || mode !== 'answer') return;
  // Schutz vor doppeltem Enter direkt nach dem Prüfen.
  if (performance.now() - current.answeredAt < 350) return;
  const now = new Date();
  const scheduled = schedule(card.srs, rating, now);
  const attempt = {
    attemptId: store.uuid(),
    shownAt: current.shownAt.toISOString(),
    submittedAt: current.submittedAt.toISOString(),
    thinkingTimeSeconds: current.thinkingTimeSeconds,
    userInput: current.input,
    inputMethod: current.dictated ? 'dictated' : 'typed',
    matchedTarget: current.result.matchedTarget,
    isExactMatch: current.result.isExactMatch,
    diffTokens: current.result.diffTokens,
    rating,
    intervalAfterText: formatInterval(scheduled),
    stateBefore: card.srs.state,
  };
  undoStack.push({ cardId: card.id, attemptId: attempt.attemptId, prevSrs: structuredClone(card.srs), exact: attempt.isExactMatch, time: attempt.thinkingTimeSeconds });
  if (undoStack.length > 50) undoStack.shift();
  store.recordAttempt(card.id, attempt, scheduled.srs);
  session.reviewed++;
  if (attempt.isExactMatch) session.exact++;
  session.times.push(attempt.thinkingTimeSeconds);
  lastCardId = card.id;
  next();
}

export function undo() {
  const entry = undoStack.pop();
  if (!entry) {
    toast('Nichts zum Rückgängigmachen');
    return;
  }
  if (!store.undoAttempt(entry.cardId, entry.attemptId, entry.prevSrs)) {
    toast('Karte existiert nicht mehr', { error: true });
    return;
  }
  session.reviewed = Math.max(0, session.reviewed - 1);
  if (entry.exact) session.exact = Math.max(0, session.exact - 1);
  session.times.pop();
  stopTimers();
  current = { cardId: entry.cardId, shownAt: new Date(), hintShown: store.settings().autoShowHint, draft: '' };
  mode = 'question';
  lastCardId = null;
  render();
  toast('Letzte Bewertung rückgängig gemacht');
}

function stopTimers() {
  clearInterval(timer);
  clearInterval(waitTimer);
  timer = null;
  waitTimer = null;
}

// ------------------------------------------------------------------ Rendering

function countsHtml(highlightState) {
  const q = buildQueues();
  const cls = (states) => (states.includes(highlightState) ? ' current' : '');
  return `<div class="counts">
    <span class="c-new${cls(['new'])}" title="Neue Karten (heute noch verfügbar)"><b>${q.fresh.length}</b>Neu</span>
    <span class="c-learn${cls(['learning', 'relearning'])}" title="Fällige Lernkarten"><b>${q.learn.length}</b>Lernen</span>
    <span class="c-review${cls(['review'])}" title="Fällige Wiederholungen"><b>${q.review.length}</b>Wiederholen</span>
  </div>`;
}

function headerHtml(card) {
  return `<div class="study-header">
    ${countsHtml(card?.srs.state)}
    <div style="display:flex;gap:8px;align-items:center">
      ${session.reviewed ? `<span class="muted small">Sitzung: ${session.reviewed} · ${session.exact} exakt</span>` : ''}
      <button class="btn ghost" data-action="undo" ${undoStack.length ? '' : 'disabled'} title="Letzte Bewertung rückgängig (⌘Z)">↶ Rückgängig</button>
    </div>
  </div>`;
}

function render() {
  if (!root || !active) return;
  if (current && !currentCard()) {
    // Karte wurde inzwischen gelöscht.
    next();
    return;
  }
  const card = currentCard();
  switch (mode) {
    case 'question':
      return renderQuestion(card);
    case 'answer':
      return renderAnswer(card);
    case 'waiting':
      return renderWaiting();
    case 'empty':
      return renderEmpty();
    default:
      return renderDone();
  }
}

function cardMeta(card, { back = false } = {}) {
  return `<div class="card-meta">
    ${statePill(card.srs.state)}
    ${tagChips(card.tags)}
    <span class="spacer"></span>
    ${back ? '<button class="btn ghost small" data-action="copy-history" title="Bisherigen Verlauf + aktuellen Versuch als Markdown kopieren">📋 Verlauf dieser Karte kopieren</button>' : ''}
    <button class="btn ghost small" data-action="edit" title="Karte bearbeiten (E)">✎ Bearbeiten</button>
  </div>`;
}

function renderQuestion(card) {
  root.innerHTML = `<div class="container">
    ${headerHtml(card)}
    <div class="card">
      ${cardMeta(card)}
      <div class="prompt-label">Übersetze ins Englische</div>
      <div class="german">${escapeHtml(card.German)}</div>
      ${
        card.Hint
          ? `<div class="hint">${
              current.hintShown
                ? `<span class="hint-text">${escapeHtml(card.Hint)}</span>`
                : `<button class="btn ghost" data-action="hint">💡 Hinweis zeigen <kbd>⌘⇧H</kbd></button>`
            }</div>`
          : ''
      }
      <textarea id="answer-input" class="answer-input" rows="2" placeholder="Deine englische Übersetzung …"
        spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off">${escapeHtml(current.draft)}</textarea>
      <div class="question-footer">
        <span class="timer" id="timer">0 s</span>
        <span class="muted small"><kbd>↵</kbd> prüfen</span>
        <button class="btn dictation${current.dictated ? ' on' : ''}" data-action="dictated" aria-pressed="${current.dictated ? 'true' : 'false'}"
          title="Markiert diesen Versuch im Export als gesprochen (per Diktier-App) statt getippt (⌘D)">${
            current.dictated ? '🎤 Diktiert ✓' : '🎤 Diktiert'
          } <kbd>⌘D</kbd></button>
        <span class="spacer"></span>
        <button class="btn" data-action="reveal" title="Ohne Antwort aufdecken (⌘↵)">Weiß nicht <kbd>⌘↵</kbd></button>
        <button class="btn primary" data-action="submit">Prüfen <kbd>↵</kbd></button>
      </div>
    </div>
  </div>`;
  const input = $('#answer-input', root);
  autoGrow(input);
  input.addEventListener('input', () => {
    current.draft = input.value;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit(e.metaKey || e.ctrlKey);
    }
  });
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  const timerEl = $('#timer', root);
  const tick = () => {
    timerEl.textContent = fmtSeconds(Math.floor((Date.now() - current.shownAt) / 1000)).replace(',0', '');
  };
  tick();
  timer = setInterval(tick, 500);
}

function bannerHtml() {
  const { result, input, thinkingTimeSeconds } = current;
  let cls = 'off';
  let text;
  const errors = result.errorCount;
  const onlyTypos = result.diffTokens.every((t) => t.status === 'ok' || t.status === 'typo');
  if (!input) text = 'Keine Antwort – präg dir die Lösung ein';
  else if (result.isExactMatch) {
    cls = 'exact';
    text = '✓ Exakt richtig';
  } else if (onlyTypos) {
    cls = 'close';
    text = `Fast richtig – ${errors === 1 ? 'ein Tippfehler' : `${errors} Tippfehler`}`;
  } else if (result.accuracy >= 0.75) {
    cls = 'close';
    text = `Knapp daneben – ${errors} ${errors === 1 ? 'Abweichung' : 'Abweichungen'}`;
  } else {
    text = `${errors} ${errors === 1 ? 'Abweichung' : 'Abweichungen'}`;
  }
  return `<div class="result-banner ${cls}">${text}
    <span class="meta">⏱ ${fmtSeconds(thinkingTimeSeconds)}</span></div>`;
}

function infoBox(title, body, wide = false) {
  return `<div class="info${wide ? ' wide' : ''}"><h3>${title}</h3>${body}</div>`;
}

function renderAnswer(card) {
  const { result } = current;
  const altLabel = result.targetIndex > 0 ? `Alternative ${result.targetIndex}` : null;
  const transfers = [card.Transfer1, card.Transfer2].filter(Boolean);
  const alternatives = [card.Alternative1, card.Alternative2].filter(Boolean);

  // Regel über die volle Breite; bei ungerader Anzahl restlicher Boxen wird die letzte breit.
  const half = [];
  if (card.Pattern) half.push(['🧩 Muster', `<p class="pattern-text">${renderMarked(card.Pattern, 'pattern')}</p>`]);
  if (card.Trap) half.push(['⚠️ Typische Falle', `<p>${renderMarked(card.Trap, 'trap')}</p>`]);
  if (transfers.length) half.push(['🔁 Transfer', transfers.map((t) => `<p>${renderMarked(t)}</p>`).join('')]);
  if (alternatives.length) half.push(['↔️ Auch richtig', alternatives.map((t) => `<p>${renderMarked(t)}</p>`).join('')]);
  const boxes = [
    ...(card.Rule ? [infoBox('📘 Regel', `<p>${renderMarked(card.Rule)}</p>`, true)] : []),
    ...half.map(([title, body], i) => infoBox(title, body, half.length % 2 === 1 && i === half.length - 1)),
  ];

  root.innerHTML = `<div class="container">
    ${headerHtml(card)}
    <div class="card">
      ${cardMeta(card, { back: true })}
      <div class="german compact">${escapeHtml(card.German)}</div>
      ${card.Hint ? `<div class="hint"><span class="hint-text">${escapeHtml(card.Hint)}</span></div>` : ''}
      ${bannerHtml()}
      ${
        current.input
          ? `<div class="answer-row"><div class="prompt-label">Deine Antwort${current.dictated ? ' · <span class="dictated-badge">🎤 diktiert</span>' : ''}</div>
             <div class="diff">${renderDiff(result.diffTokens)}</div></div>`
          : ''
      }
      <div class="answer-row"><div class="prompt-label">Lösung</div>
        <div class="solution">${renderMarked(card.English)}</div>
        ${altLabel ? `<div class="alt-note">Deine Antwort wurde mit ${altLabel} verglichen: „${escapeHtml(result.matchedTarget)}“</div>` : ''}
      </div>
    </div>
    ${boxes.length ? `<div class="info-grid">${boxes.join('')}</div>` : ''}
    <div class="rating-bar">
      <div class="rating-buttons">
        ${RATINGS.map(
          (r, i) => `<button class="rate${r === current.suggested ? ' suggested' : ''}" data-rating="${r}">
            <kbd>${i + 1}</kbd><span class="label">${r}</span><span class="ivl">${current.previews[r]}</span>
          </button>`,
        ).join('')}
      </div>
    </div>
  </div>`;
  document.activeElement?.blur?.();
}

function renderWaiting() {
  const { queues } = pickNext();
  const nextCard = queues.upcoming[0];
  root.innerHTML = `<div class="container">
    ${headerHtml(null)}
    <div class="empty-state">
      <div class="big">⏳</div>
      <h2>Kurze Pause</h2>
      <p>${queues.upcoming.length === 1 ? 'Eine Lernkarte kommt' : `${queues.upcoming.length} Lernkarten kommen`} gleich zurück.
        Nächste in <b id="wait-countdown">…</b>.</p>
      <div class="actions">
        <button class="btn primary" data-action="learn-ahead">Jetzt schon wiederholen</button>
        <button class="btn" data-action="new-card">Neue Karte anlegen</button>
      </div>
    </div>
  </div>`;
  const tick = () => {
    const ms = Date.parse(nextCard.srs.dueDate) - Date.now();
    if (ms <= 0) {
      next();
      return;
    }
    const s = Math.ceil(ms / 1000);
    const el = $('#wait-countdown', root);
    if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  waitTimer = setInterval(tick, 1000);
}

function learnAhead() {
  const { queues } = pickNext();
  const card = queues.upcoming[0];
  if (!card) return next();
  stopTimers();
  current = { cardId: card.id, shownAt: new Date(), hintShown: store.settings().autoShowHint, draft: '' };
  mode = 'question';
  render();
}

function sessionTiles() {
  const avg = session.times.length ? session.times.reduce((a, b) => a + b, 0) / session.times.length : null;
  return `<div class="tiles">
    <div class="tile"><div class="label">Wiederholt</div><div class="value">${session.reviewed}</div></div>
    <div class="tile"><div class="label">Exakt richtig</div><div class="value">${session.reviewed ? fmtPercent(session.exact / session.reviewed) : '–'}</div></div>
    <div class="tile"><div class="label">Ø Denkzeit</div><div class="value">${fmtSeconds(avg)}</div></div>
  </div>`;
}

function renderDone() {
  const q = buildQueues();
  const nextReview = store
    .cards()
    .filter((c) => c.srs.state !== 'new')
    .sort((a, b) => Date.parse(a.srs.dueDate) - Date.parse(b.srs.dueDate))[0];
  const moreNew = q.freshTotal - q.fresh.length;
  root.innerHTML = `<div class="container">
    ${headerHtml(null)}
    <div class="empty-state">
      <div class="big">🎉</div>
      <h2>Für heute geschafft!</h2>
      <p>${nextReview ? `Die nächste Wiederholung ist ${relativeDue(nextReview.srs.dueDate)} fällig.` : 'Alle Karten sind erledigt.'}
        ${moreNew > 0 ? ` ${moreNew} neue ${moreNew === 1 ? 'Karte wartet' : 'Karten warten'} noch (Tageslimit erreicht).` : ''}</p>
      ${session.reviewed ? sessionTiles() : ''}
      <div class="actions">
        ${moreNew > 0 ? `<button class="btn primary" data-action="more-new">+${Math.min(10, moreNew)} neue Karten lernen</button>` : ''}
        <button class="btn" data-action="new-card">Neue Karte anlegen</button>
      </div>
    </div>
  </div>`;
}

function renderEmpty() {
  root.innerHTML = `<div class="container">
    <div class="empty-state">
      <div class="big">🗂️</div>
      <h2>Noch keine Karten</h2>
      <p>Lege deine erste Karte an oder importiere eine JSON-Datei mit Karten.</p>
      <div class="actions">
        <button class="btn primary" data-action="new-card">Neue Karte anlegen</button>
        <button class="btn" data-action="import">Karten importieren</button>
      </div>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ Events

function editCurrent() {
  const card = currentCard();
  if (!card) return;
  openEditor(card.id, {
    onSaved: () => {
      if (mode === 'answer') {
        // Ergebnis gegen die korrigierte Karte neu berechnen.
        const updated = currentCard();
        const result = compareAnswer(current.input, [updated.English, updated.Alternative1, updated.Alternative2]);
        current = { ...current, result, suggested: current.input ? suggestRating(result) : 'Nochmal', answeredAt: 0 };
      }
      render();
    },
    onDeleted: () => {
      lastCardId = null;
      next();
    },
  });
}

/** Markiert den laufenden Versuch als diktiert/getippt; der Text im Eingabefeld bleibt erhalten. */
function toggleDictated() {
  if (mode !== 'question') return;
  current.dictated = !current.dictated;
  const input = $('#answer-input', root);
  current.draft = input.value;
  const btn = $('[data-action="dictated"]', root);
  btn.classList.toggle('on', current.dictated);
  btn.setAttribute('aria-pressed', String(current.dictated));
  btn.firstChild.textContent = current.dictated ? '🎤 Diktiert ✓ ' : '🎤 Diktiert ';
  input.focus();
}

/** Kopiert den Verlauf der aktuellen Karte – inkl. des gerade geprüften, noch unbewerteten Versuchs. */
function copyCurrentHistory() {
  const card = currentCard();
  if (!card) return;
  const pending =
    mode === 'answer'
      ? {
          shownAt: current.shownAt.toISOString(),
          submittedAt: current.submittedAt.toISOString(),
          thinkingTimeSeconds: current.thinkingTimeSeconds,
          userInput: current.input,
          inputMethod: current.dictated ? 'dictated' : 'typed',
          matchedTarget: current.result.matchedTarget,
          isExactMatch: current.result.isExactMatch,
          diffTokens: current.result.diffTokens,
          rating: null,
        }
      : null;
  copyCardHistory(card.id, pending);
}

/** Nach dem Austausch der Datenbank (Backup) ist der Undo-Verlauf ungültig. */
export function clearUndo() {
  undoStack = [];
}

let hooks = {};

export function mount(el, appHooks) {
  root = el;
  hooks = appHooks;
  root.addEventListener('click', (e) => {
    const rateBtn = e.target.closest('[data-rating]');
    if (rateBtn) {
      if (current) current.answeredAt = 0;
      return rate(rateBtn.dataset.rating);
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    switch (action) {
      case 'submit':
        return submit(false);
      case 'reveal':
        return submit(true);
      case 'dictated':
        return toggleDictated();
      case 'hint':
        current.hintShown = true;
        return render();
      case 'edit':
        return editCurrent();
      case 'copy-history':
        return copyCurrentHistory();
      case 'undo':
        return undo();
      case 'learn-ahead':
        return learnAhead();
      case 'more-new':
        session.extraNew += 10;
        return next();
      case 'new-card':
        return openEditor(null, { onSaved: () => next() });
      case 'import':
        return hooks.openImport?.();
    }
  });
}

export function activate() {
  active = true;
  if (mode === 'idle' || mode === 'done' || mode === 'empty' || mode === 'waiting' || (current && !currentCard())) next();
  else render();
}

export function deactivate() {
  active = false;
  stopTimers();
}

/** Wird bei Datenänderungen aus anderen Views aufgerufen. */
export function refresh() {
  if (!active) return;
  if (mode === 'done' || mode === 'empty' || mode === 'waiting' || mode === 'idle') next();
}

export function handleKey(e) {
  if (!active) return false;
  const typing = e.target.matches?.('input, textarea, select');
  if (mode === 'question') {
    if (e.key.toLowerCase() === 'd' && e.metaKey && !e.shiftKey && !e.altKey) {
      toggleDictated();
      return true;
    }
    if (e.key.toLowerCase() === 'h' && e.metaKey && e.shiftKey) {
      current.hintShown = true;
      render();
      return true;
    }
    if (!typing && e.key === 'Enter') {
      submit(e.metaKey || e.ctrlKey);
      return true;
    }
    if (!typing && e.key.toLowerCase() === 'e' && !e.metaKey) {
      editCurrent();
      return true;
    }
    return false;
  }
  if (mode === 'answer' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const index = ['1', '2', '3', '4'].indexOf(e.key);
    if (index !== -1) {
      rate(RATINGS[index]);
      return true;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      rate(current.suggested);
      return true;
    }
    if (e.key.toLowerCase() === 'e') {
      editCurrent();
      return true;
    }
  }
  return false;
}
