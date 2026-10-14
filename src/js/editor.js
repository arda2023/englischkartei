// Dialog zum Anlegen/Bearbeiten einer Karte mit Live-Vorschau der [[…]]-Marker.

import * as store from './store.js';
import { escapeHtml, renderMarked } from '../lib/markup.js';
import { $, openModal, toast } from './ui.js';

const FIELD_META = {
  German: { label: 'Deutsch', required: true, wide: true, help: 'Der Satz, den du ins Englische übersetzt.' },
  English: { label: 'English (Zielsatz)', required: true, wide: true, help: 'Schlüsselteile mit [[…]] markieren.' },
  Hint: { label: 'Hinweis', help: 'Kurzer Denkanstoß, z. B. die Zeitform.' },
  Pattern: { label: 'Muster', help: 'Satzbauplan, z. B. When + [Past Simple], …' },
  Trap: { label: 'Typische Falle', wide: true, help: 'Häufiger Fehler – der Fehler selbst in [[…]].' },
  Rule: { label: 'Regel', wide: true, help: 'Warum ist es so richtig?' },
  Transfer1: { label: 'Transfer 1', help: 'Gleiches Muster, anderer Kontext.' },
  Transfer2: { label: 'Transfer 2' },
  Alternative1: { label: 'Alternative 1', help: 'Wird beim Prüfen ebenfalls akzeptiert.' },
  Alternative2: { label: 'Alternative 2', help: 'Wird beim Prüfen ebenfalls akzeptiert.' },
};

const FIELD_ORDER = ['German', 'English', 'Hint', 'Pattern', 'Trap', 'Rule', 'Transfer1', 'Transfer2', 'Alternative1', 'Alternative2'];

// Felder mit [[…]]-Markern bekommen eine Live-Vorschau (Klasse = Darstellung der Markierung).
const PREVIEW_CLASS = {
  English: 'hl',
  Pattern: 'pattern',
  Trap: 'trap',
  Rule: 'hl',
  Transfer1: 'hl',
  Transfer2: 'hl',
  Alternative1: 'hl',
  Alternative2: 'hl',
};

function hasBrokenMarkers(text) {
  return /\[\[|\]\]/.test(text.replace(/\[\[.+?\]\]/g, ''));
}

/**
 * @param {string|null} cardId  null = neue Karte
 * @param {{onSaved?:Function, onDeleted?:Function}} opts
 */
export function openEditor(cardId = null, { onSaved, onDeleted } = {}) {
  const card = cardId ? store.getCard(cardId) : null;
  const isNew = !card;

  const modal = openModal({
    title: isNew ? 'Neue Karte' : 'Karte bearbeiten',
    footer: `
      ${isNew ? '' : '<button class="btn danger" data-action="delete">Löschen</button><button class="btn ghost" data-action="reset">Fortschritt zurücksetzen</button>'}
      <span class="spacer"></span>
      <button class="btn" data-action="cancel">Abbrechen</button>
      <button class="btn primary" data-action="save">${isNew ? 'Anlegen' : 'Speichern'} <kbd>⌘↵</kbd></button>`,
  });

  modal.body.innerHTML = `
    <div class="form-grid">
      ${FIELD_ORDER.map((field) => {
        const meta = FIELD_META[field];
        return `<div class="field${meta.wide ? ' wide' : ''}" data-field="${field}">
          <label>${meta.label}${meta.required ? ' <span class="req">*</span>' : ''}</label>
          <textarea rows="2" spellcheck="false" name="${field}">${escapeHtml(card?.[field] ?? '')}</textarea>
          ${PREVIEW_CLASS[field] ? `<div class="md-preview" data-preview="${field}" hidden></div>` : ''}
          ${meta.help ? `<span class="help">${meta.help}</span>` : ''}
        </div>`;
      }).join('')}
      <div class="field wide">
        <label>Tags</label>
        <input type="text" name="tags" spellcheck="false" placeholder="tenses, past-continuous, travel" value="${escapeHtml(card?.tags.join(', ') ?? '')}" />
        <span class="help">Kommagetrennt.</span>
      </div>
    </div>`;

  const updatePreview = (field) => {
    const preview = $(`[data-preview="${field}"]`, modal.body);
    if (!preview) return;
    const value = $(`[name="${field}"]`, modal.body).value;
    const broken = hasBrokenMarkers(value);
    preview.hidden = !value.includes('[[') && !value.includes(']]');
    preview.classList.toggle('broken', broken);
    preview.innerHTML = broken
      ? '⚠ [[ und ]] passen nicht zusammen'
      : `<span class="md-preview-label">Vorschau</span> ${renderMarked(value, PREVIEW_CLASS[field])}`;
  };
  Object.keys(PREVIEW_CLASS).forEach(updatePreview);
  modal.body.addEventListener('input', (e) => {
    if (e.target.name && PREVIEW_CLASS[e.target.name]) updatePreview(e.target.name);
    if (e.target.name === 'German' || e.target.name === 'English') {
      e.target.closest('.field').classList.remove('invalid');
    }
  });

  const save = () => {
    const fields = {};
    for (const field of FIELD_ORDER) fields[field] = $(`[name="${field}"]`, modal.body).value;
    fields.tags = $('[name="tags"]', modal.body).value;
    let valid = true;
    for (const field of ['German', 'English']) {
      const ok = fields[field].trim().length > 0;
      $(`[data-field="${field}"]`, modal.body).classList.toggle('invalid', !ok);
      if (!ok) valid = false;
    }
    const broken = FIELD_ORDER.find((f) => hasBrokenMarkers(fields[f]));
    if (broken) {
      toast(`„${FIELD_META[broken].label}“: [[ und ]] passen nicht zusammen.`, { error: true });
      return;
    }
    if (!valid) {
      toast('Deutsch und English sind Pflichtfelder.', { error: true });
      return;
    }
    const saved = isNew ? store.createCard(fields) : store.updateCard(card.id, fields);
    toast(isNew ? 'Karte angelegt' : 'Änderungen gespeichert');
    modal.close();
    onSaved?.(saved);
  };

  modal.el.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'cancel') modal.close();
    if (action === 'save') save();
    if (action === 'delete') {
      const removed = store.deleteCard(card.id);
      modal.close();
      onDeleted?.(card);
      toast('Karte gelöscht', { action: { label: 'Rückgängig', run: () => store.restoreCard(removed) } });
    }
    if (action === 'reset') {
      const ok = await window.api.confirm(
        'Lernfortschritt zurücksetzen?',
        'Die Karte wird wieder als neu eingeplant. Der Verlauf bleibt erhalten.',
      );
      if (!ok) return;
      store.resetProgress(card.id);
      toast('Fortschritt zurückgesetzt');
      modal.close();
      onSaved?.(store.getCard(card.id));
    }
  });

  modal.el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  });

  $('[name="German"]', modal.body).focus();
  return modal;
}
