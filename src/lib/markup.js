// Hilfsfunktionen für die [[...]]-Markierung in Kartenfeldern.

const MARK_RE = /\[\[(.+?)\]\]/g;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Entfernt die [[ ]]-Klammern, der Inhalt bleibt erhalten. */
export function stripMarkup(text) {
  return String(text ?? '').replace(MARK_RE, '$1');
}

/** Escaped den Text und rendert [[x]] als <mark class="cls">x</mark>. */
export function renderMarked(text, cls = 'hl') {
  return escapeHtml(text).replace(MARK_RE, (_, inner) => `<mark class="${cls}">${inner}</mark>`);
}
