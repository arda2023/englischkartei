// Wortweiser Vergleich zwischen Nutzereingabe und Zielsatz.
//
// Groß-/Kleinschreibung und Satzzeichen werden ignoriert, typografische Apostrophe
// vereinheitlicht und gängige Kurzformen (don't ↔ do not, he's ↔ he is/has) als
// gleichwertig behandelt. Die Ausrichtung ist eine gewichtete Levenshtein-Distanz
// auf Wortebene, wodurch Ersetzungen als Paar (falsch → erwartet) erkannt werden.

import { stripMarkup } from './markup.js';

// Mehrdeutige Kurzformen bekommen mehrere zulässige Schlüssel pro Teilwort.
const CONTRACTIONS = {
  "i'm": [['i'], ['am']],
  "you're": [['you'], ['are']],
  "we're": [['we'], ['are']],
  "they're": [['they'], ['are']],
  "he's": [['he'], ['is', 'has']],
  "she's": [['she'], ['is', 'has']],
  "it's": [['it'], ['is', 'has']],
  "that's": [['that'], ['is', 'has']],
  "there's": [['there'], ['is', 'has']],
  "here's": [['here'], ['is']],
  "what's": [['what'], ['is', 'has']],
  "who's": [['who'], ['is', 'has']],
  "where's": [['where'], ['is']],
  "how's": [['how'], ['is']],
  "let's": [['let'], ['us']],
  "isn't": [['is'], ['not']],
  "aren't": [['are'], ['not']],
  "wasn't": [['was'], ['not']],
  "weren't": [['were'], ['not']],
  "don't": [['do'], ['not']],
  "doesn't": [['does'], ['not']],
  "didn't": [['did'], ['not']],
  "haven't": [['have'], ['not']],
  "hasn't": [['has'], ['not']],
  "hadn't": [['had'], ['not']],
  "won't": [['will'], ['not']],
  "wouldn't": [['would'], ['not']],
  "shouldn't": [['should'], ['not']],
  "couldn't": [['could'], ['not']],
  "mustn't": [['must'], ['not']],
  "needn't": [['need'], ['not']],
  "can't": [['can'], ['not']],
  cannot: [['can'], ['not']],
  "i've": [['i'], ['have']],
  "you've": [['you'], ['have']],
  "we've": [['we'], ['have']],
  "they've": [['they'], ['have']],
  "i'll": [['i'], ['will']],
  "you'll": [['you'], ['will']],
  "he'll": [['he'], ['will']],
  "she'll": [['she'], ['will']],
  "it'll": [['it'], ['will']],
  "we'll": [['we'], ['will']],
  "they'll": [['they'], ['will']],
  "that'll": [['that'], ['will']],
  "i'd": [['i'], ['would', 'had']],
  "you'd": [['you'], ['would', 'had']],
  "he'd": [['he'], ['would', 'had']],
  "she'd": [['she'], ['would', 'had']],
  "it'd": [['it'], ['would', 'had']],
  "we'd": [['we'], ['would', 'had']],
  "they'd": [['they'], ['would', 'had']],
};

// Ersetzung < fehlend + überzählig, aber > ein einzelnes Loch: so werden Lücken
// nicht durch Ketten von Ersetzungen „verschmiert“.
// Kurzformen ohne Apostroph („dont“, „im“) werden erkannt, aber als Tippfehler gewertet.
// Ausgenommen sind echte Wörter: its, were, well, hell, shell, ill, id, wed, hed, shed, lets.
const NOT_SLOPPY = new Set(['its', 'were', 'well', 'hell', 'shell', 'ill', 'id', 'wed', 'hed', 'shed', 'lets', 'cannot']);
const SLOPPY = Object.fromEntries(
  Object.keys(CONTRACTIONS)
    .map((k) => [k.replace(/'/g, ''), k])
    .filter(([plain, k]) => plain !== k && !NOT_SLOPPY.has(plain)),
);

const COST = { ok: 0, typo: 0.4, wrong: 1.5, missing: 1, extra: 1 };

function normalizeWord(raw) {
  return raw
    .toLowerCase()
    .replace(/[‘’‛`´]/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Zerlegt einen Satz in vergleichbare Wort-Tokens. */
export function tokenize(text) {
  const tokens = [];
  const raws = stripMarkup(text).split(/\s+/).filter(Boolean);
  raws.forEach((original, orig) => {
    const raw = original.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
    const norm = normalizeWord(raw);
    if (!norm) return; // reine Satzzeichen wie "–"
    const canonical = SLOPPY[norm];
    const expansion = CONTRACTIONS[canonical ?? norm];
    if (expansion) {
      expansion.forEach((keys, part) => {
        tokens.push({ display: keys[0], raw, keys, orig, part, parts: expansion.length, canonical });
      });
    } else {
      tokens.push({ display: raw, raw, keys: [norm], orig, part: 0, parts: 1 });
    }
  });
  return tokens;
}

/** Optimal String Alignment Distance (Levenshtein + Vertauschung). */
export function editDistance(a, b) {
  const n = a.length;
  const m = b.length;
  const d = Array.from({ length: n + 1 }, (_, i) => [i, ...new Array(m).fill(0)]);
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[n][m];
}

function sameWord(u, t) {
  return u.keys.some((k) => t.keys.includes(k));
}

function isTypo(u, t) {
  if (u.keys.length !== 1 || t.keys.length !== 1) return false;
  const a = u.keys[0];
  const b = t.keys[0];
  const len = Math.max(a.length, b.length);
  const allowed = len >= 8 ? 2 : len >= 4 ? 1 : 0;
  return allowed > 0 && editDistance(a, b) <= allowed;
}

/** Vergleicht eine Eingabe mit genau einem Zielsatz. */
export function diffAgainst(userInput, target) {
  const user = tokenize(userInput);
  const goal = tokenize(target);
  const n = user.length;
  const m = goal.length;

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) dp[i][0] = i * COST.extra;
  for (let j = 1; j <= m; j++) dp[0][j] = j * COST.missing;
  const diagCost = (i, j) => {
    const u = user[i - 1];
    const t = goal[j - 1];
    if (sameWord(u, t)) return COST.ok;
    if (isTypo(u, t)) return COST.typo;
    return COST.wrong;
  };
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j - 1] + diagCost(i, j),
        dp[i][j - 1] + COST.missing,
        dp[i - 1][j] + COST.extra,
      );
    }
  }

  // Rückverfolgung – diagonale Schritte bevorzugt, damit Ersetzungen als Paar erscheinen.
  const ops = [];
  let i = n;
  let j = m;
  const EPS = 1e-9;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const c = diagCost(i, j);
      if (Math.abs(dp[i][j] - (dp[i - 1][j - 1] + c)) < EPS) {
        const status = c === COST.ok ? 'ok' : c === COST.typo ? 'typo' : 'wrong';
        ops.push({ status, u: user[i - 1], t: goal[j - 1] });
        i--;
        j--;
        continue;
      }
    }
    if (j > 0 && Math.abs(dp[i][j] - (dp[i][j - 1] + COST.missing)) < EPS) {
      ops.push({ status: 'missing', t: goal[j - 1] });
      j--;
      continue;
    }
    ops.push({ status: 'extra', u: user[i - 1] });
    i--;
  }
  ops.reverse();

  const diffTokens = [];
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.status === 'ok') {
      // Aufgelöste Kurzformen wieder zusammenfassen, wenn alle Teile stimmen.
      const { orig, parts } = op.u;
      if (parts > 1 && op.u.part === 0) {
        const run = ops.slice(k, k + parts);
        if (run.length === parts && run.every((o) => o.status === 'ok' && o.u.orig === orig)) {
          if (op.u.canonical) {
            const expected = /^\p{Lu}/u.test(op.u.raw) ? op.u.canonical[0].toUpperCase() + op.u.canonical.slice(1) : op.u.canonical;
            diffTokens.push({ text: op.u.raw, status: 'typo', expected });
          } else {
            diffTokens.push({ text: op.u.raw, status: 'ok' });
          }
          k += parts - 1;
          continue;
        }
      }
      diffTokens.push({ text: op.u.display, status: 'ok' });
    } else if (op.status === 'missing') {
      diffTokens.push({ text: '', status: 'missing', expected: op.t.display });
    } else if (op.status === 'extra') {
      diffTokens.push({ text: op.u.display, status: 'extra' });
    } else {
      diffTokens.push({ text: op.u.display, status: op.status, expected: op.t.display });
    }
  }

  const okCount = ops.filter((o) => o.status === 'ok').length;
  const sloppy = ops.some((o) => o.status === 'ok' && o.u.canonical);
  return {
    target: stripMarkup(target),
    diffTokens,
    cost: dp[n][m] + (sloppy ? COST.typo : 0),
    isExactMatch: n > 0 && dp[n][m] === 0 && !sloppy,
    accuracy: m === 0 ? 0 : Math.max(0, (okCount - ops.filter((o) => o.status === 'extra').length) / m),
  };
}

/**
 * Vergleicht die Eingabe mit allen zulässigen Zielsätzen (English, Alternativen)
 * und liefert den am besten passenden.
 */
export function compareAnswer(userInput, targets) {
  let best = null;
  targets.forEach((target, index) => {
    if (!target || !stripMarkup(target).trim()) return;
    const result = diffAgainst(userInput, target);
    if (!best || result.cost < best.cost) best = { ...result, targetIndex: index };
  });
  if (!best) throw new Error('Karte hat keinen englischen Zielsatz');
  return {
    matchedTarget: best.target,
    targetIndex: best.targetIndex,
    isExactMatch: best.isExactMatch,
    diffTokens: best.diffTokens,
    accuracy: best.accuracy,
    errorCount: best.diffTokens.filter((t) => t.status !== 'ok').length,
  };
}

/** Vorschlag für die Bewertung anhand des Ergebnisses (der Nutzer entscheidet). */
export function suggestRating(result) {
  if (result.isExactMatch) return 'Gut';
  const onlyTypos = result.diffTokens.every((t) => t.status === 'ok' || t.status === 'typo');
  if (onlyTypos) return 'Gut';
  if (result.accuracy >= 0.75) return 'Schwer';
  return 'Nochmal';
}
