// Statistik: Kennzahlen, Aktivität der letzten 30 Tage, Prognose, Problemkarten.

import * as store from './store.js';
import { escapeHtml } from '../lib/markup.js';
import { RATINGS } from '../lib/srs.js';
import { fmtPercent, fmtSeconds, fmtNumber, dayKey, startOfDay, showTooltip, hideTooltip, STATE_LABELS, statePill } from './ui.js';
import { openDetails } from './details.js';
import { dueCount } from './study.js';

let root;
let active = false;

const DAY = 86400000;
const weekday = (d) => d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

function allAttempts() {
  const out = [];
  for (const card of store.cards()) for (const a of card.history) out.push({ ...a, card });
  return out;
}

function niceScale(max) {
  const raw = Math.max(max, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((x) => x * mag).find((s) => s >= raw);
  const niceStep = Math.max(1, Math.ceil(step));
  return { max: niceStep * 4, ticks: [0, 1, 2, 3, 4].map((i) => i * niceStep) };
}

/**
 * Säulendiagramm (eine Serie): hairline-Raster, 4px runde Säulen-Enden,
 * Tooltip je Säule und eine Tabellenansicht als Alternative.
 */
function columnChart(points, { unit, tableHeaders }) {
  const { max, ticks } = niceScale(Math.max(...points.map((p) => p.value)));
  const pct = (v) => (v / max) * 100;
  return `
    <div class="chart">
      <div class="y-axis">${ticks.map((t) => `<span style="bottom:${pct(t)}%">${fmtNumber(t)}</span>`).join('')}</div>
      <div class="plot">
        ${ticks.slice(1).map((t) => `<div class="grid-line" style="bottom:${pct(t)}%"></div>`).join('')}
        <div class="bars">
          ${points
            .map(
              (p) => `<div class="bar-slot${p.highlight ? ' today' : ''}" data-tip="${escapeHtml(p.tooltip)}">
                <div class="bar" style="height:${pct(p.value)}%"></div></div>`,
            )
            .join('')}
        </div>
      </div>
    </div>
    <div class="x-axis"><span></span><div class="labels">
      <span>${points[0].label}</span><span>${points[Math.floor(points.length / 2)].label}</span><span>${points[points.length - 1].label}</span>
    </div></div>
    <details class="table-view"><summary>Als Tabelle anzeigen</summary>
      <table class="data" style="margin-top:8px">
        <thead><tr><th>${tableHeaders[0]}</th><th class="num">${tableHeaders[1]}</th>${tableHeaders[2] ? `<th class="num">${tableHeaders[2]}</th>` : ''}</tr></thead>
        <tbody>${points
          .map((p) => `<tr><td>${p.fullLabel}</td><td class="num">${fmtNumber(p.value)} ${unit}</td>${p.extra != null ? `<td class="num">${p.extra}</td>` : ''}</tr>`)
          .join('')}</tbody>
      </table>
    </details>`;
}

function streakDays(attempts) {
  const days = new Set(attempts.map((a) => dayKey(a.submittedAt)));
  let cursor = startOfDay();
  if (!days.has(dayKey(cursor))) cursor = new Date(cursor.getTime() - DAY);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function render() {
  const cards = store.cards();
  const attempts = allAttempts();
  const now = new Date();
  const today = startOfDay(now);
  const since30 = new Date(today.getTime() - 29 * DAY);
  const recent = attempts.filter((a) => new Date(a.submittedAt) >= since30);
  const todayAttempts = attempts.filter((a) => new Date(a.submittedAt) >= today);
  const avgTime = recent.length ? recent.reduce((s, a) => s + (a.thinkingTimeSeconds || 0), 0) / recent.length : null;
  const exactRate = recent.length ? recent.filter((a) => a.isExactMatch).length / recent.length : null;

  // Aktivität 30 Tage
  const activity = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(since30.getTime() + i * DAY);
    const key = dayKey(d);
    const dayAttempts = recent.filter((a) => dayKey(a.submittedAt) === key);
    const exact = dayAttempts.filter((a) => a.isExactMatch).length;
    activity.push({
      label: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
      fullLabel: weekday(d),
      value: dayAttempts.length,
      extra: dayAttempts.length ? fmtPercent(exact / dayAttempts.length) : '–',
      highlight: i === 29,
      tooltip: `${weekday(d)}: <b>${dayAttempts.length}</b> Wiederholungen${dayAttempts.length ? ` · ${fmtPercent(exact / dayAttempts.length)} exakt` : ''}`,
    });
  }

  // Prognose 14 Tage (Überfälliges zählt für heute)
  const forecast = [];
  for (let i = 0; i < 14; i++) {
    const start = new Date(today.getTime() + i * DAY);
    const end = new Date(start.getTime() + DAY);
    const count = cards.filter((c) => {
      if (c.srs.state === 'new') return false;
      const due = new Date(c.srs.dueDate);
      return (i === 0 ? true : due >= start) && due < end;
    }).length;
    forecast.push({
      label: i === 0 ? 'heute' : start.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
      fullLabel: i === 0 ? 'Heute (inkl. überfällig)' : weekday(start),
      value: count,
      highlight: i === 0,
      tooltip: `${i === 0 ? 'Heute (inkl. überfällig)' : weekday(start)}: <b>${count}</b> fällig`,
    });
  }

  // Status & Bewertungen
  const states = { new: 0, learning: 0, relearning: 0, review: 0 };
  for (const c of cards) states[c.srs.state] = (states[c.srs.state] || 0) + 1;
  const ratings = Object.fromEntries(RATINGS.map((r) => [r, recent.filter((a) => a.rating === r).length]));

  // Tags
  const tagStats = new Map();
  for (const a of attempts) {
    for (const t of a.card.tags) {
      const s = tagStats.get(t) || { attempts: 0, exact: 0, time: 0 };
      s.attempts++;
      if (a.isExactMatch) s.exact++;
      s.time += a.thinkingTimeSeconds || 0;
      tagStats.set(t, s);
    }
  }
  const tagRows = [...tagStats.entries()].sort((a, b) => a[1].exact / a[1].attempts - b[1].exact / b[1].attempts).slice(0, 12);

  // Problemkarten
  const hard = cards
    .filter((c) => c.history.length >= 2 || c.srs.lapses > 0)
    .map((c) => ({ card: c, rate: c.history.filter((a) => !a.isExactMatch).length / Math.max(1, c.history.length) }))
    .filter((x) => x.rate > 0 || x.card.srs.lapses > 0)
    .sort((a, b) => b.card.srs.lapses - a.card.srs.lapses || b.rate - a.rate)
    .slice(0, 8);

  root.innerHTML = `<div class="container">
    <div class="tiles">
      <div class="tile"><div class="label">Karten gesamt</div><div class="value">${fmtNumber(cards.length)}</div>
        <div class="sub">${states.review} im Langzeitgedächtnis</div></div>
      <div class="tile"><div class="label">Jetzt fällig</div><div class="value">${fmtNumber(dueCount())}</div>
        <div class="sub">inkl. neuer Karten</div></div>
      <div class="tile"><div class="label">Heute wiederholt</div><div class="value">${fmtNumber(todayAttempts.length)}</div>
        <div class="sub">${todayAttempts.length ? `${fmtPercent(todayAttempts.filter((a) => a.isExactMatch).length / todayAttempts.length)} exakt` : '–'}</div></div>
      <div class="tile"><div class="label">Exakt richtig</div><div class="value">${fmtPercent(exactRate)}</div>
        <div class="sub">letzte 30 Tage</div></div>
      <div class="tile"><div class="label">Ø Denkzeit</div><div class="value">${fmtSeconds(avgTime)}</div>
        <div class="sub">letzte 30 Tage</div></div>
      <div class="tile"><div class="label">Serie</div><div class="value">${streakDays(attempts)}</div>
        <div class="sub">Tage in Folge</div></div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Wiederholungen pro Tag</h2><span class="muted small">letzte 30 Tage</span></div>
      <div class="panel">${columnChart(activity, { unit: '', tableHeaders: ['Tag', 'Wiederholungen', 'Exakt'] })}</div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Prognose: fällige Karten</h2><span class="muted small">nächste 14 Tage</span></div>
      <div class="panel">${columnChart(forecast, { unit: '', tableHeaders: ['Tag', 'Fällig'] })}</div>
    </div>

    <div class="section two-col">
      <div>
        <div class="section-head"><h2>Kartenstatus</h2></div>
        <div class="panel kv">
          ${Object.entries(states)
            .map(([s, n]) => `<span>${statePill(s)}</span><span class="v">${fmtNumber(n)}</span>`)
            .join('')}
        </div>
      </div>
      <div>
        <div class="section-head"><h2>Bewertungen</h2><span class="muted small">letzte 30 Tage</span></div>
        <div class="panel kv">
          ${RATINGS.map(
            (r) => `<span class="pill rating-${r}">${r}</span><span class="v">${fmtNumber(ratings[r])}
              <span class="muted">(${recent.length ? fmtPercent(ratings[r] / recent.length) : '–'})</span></span>`,
          ).join('')}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Schwierigste Karten</h2><span class="muted small">nach Lapses und Fehlerquote</span></div>
      <div class="panel">${
        hard.length
          ? `<table class="data"><thead><tr><th>Deutsch</th><th>Status</th><th class="num">Versuche</th><th class="num">Fehlerquote</th><th class="num">Lapses</th></tr></thead>
            <tbody>${hard
              .map(
                ({ card, rate }) => `<tr class="clickable" data-id="${card.id}"><td>${escapeHtml(card.German)}</td>
                  <td>${STATE_LABELS[card.srs.state]}</td><td class="num">${card.history.length}</td>
                  <td class="num">${fmtPercent(rate)}</td><td class="num">${card.srs.lapses}</td></tr>`,
              )
              .join('')}</tbody></table>`
          : '<p class="muted" style="margin:0">Noch keine Problemkarten – weiter so!</p>'
      }</div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Themen (Tags)</h2><span class="muted small">schwächste zuerst</span></div>
      <div class="panel">${
        tagRows.length
          ? `<table class="data"><thead><tr><th>Tag</th><th class="num">Versuche</th><th class="num">Exakt</th><th class="num">Ø Denkzeit</th></tr></thead>
            <tbody>${tagRows
              .map(
                ([t, s]) => `<tr><td>${escapeHtml(t)}</td><td class="num">${s.attempts}</td>
                  <td class="num">${fmtPercent(s.exact / s.attempts)}</td><td class="num">${fmtSeconds(s.time / s.attempts)}</td></tr>`,
              )
              .join('')}</tbody></table>`
          : '<p class="muted" style="margin:0">Noch keine Daten.</p>'
      }</div>
    </div>
  </div>`;
}

export function mount(el) {
  root = el;
  root.addEventListener('mousemove', (e) => {
    const slot = e.target.closest('.bar-slot');
    if (!slot) return hideTooltip();
    const rect = slot.getBoundingClientRect();
    showTooltip(slot.dataset.tip, rect.left + rect.width / 2, Math.min(e.clientY, rect.bottom - 20));
  });
  root.addEventListener('mouseleave', hideTooltip);
  root.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (row) openDetails(row.dataset.id);
  });
}

export function activate() {
  active = true;
  render();
}

export function deactivate() {
  active = false;
  hideTooltip();
}

export function refresh() {
  if (active) render();
}
