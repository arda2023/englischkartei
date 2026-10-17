# Englischkartei

Native macOS-Desktop-App (Electron, Vanilla JS) für **aktives** Englisch-Training: Du siehst einen deutschen Satz,
schreibst die englische Übersetzung selbst und bekommst einen wortgenauen Vergleich mit Regel, Muster, typischer
Falle und Transfer-Sätzen. Die Wiederholung wird per Spaced Repetition geplant.

## Start

```bash
npm install
npm start
```

Tests (Diff- und SRS-Logik): `npm test`

## Ablauf beim Lernen

1. Deutscher Satz erscheint, die Denkzeit läuft (`💡 Hinweis` optional, ⌘⇧H).
2. Übersetzung tippen → <kbd>↵</kbd> prüft. „Weiß nicht“ (⌘↵) deckt ohne Antwort auf.
3. Wortweiser Diff gegen den passendsten Zielsatz (`English`, `Alternative1`, `Alternative2`):
   - Groß-/Kleinschreibung und Satzzeichen werden ignoriert
   - Kurzformen sind gleichwertig (`don't` = `do not`, `he's` = `he is/has`)
   - Tippfehler (`passangers`) und Kurzformen ohne Apostroph (`dont`) zählen als **Tippfehler**, nicht als Fehler
   - Markierungen: falsch → richtig, fehlt, überflüssig
4. Bewertung mit <kbd>1</kbd>–<kbd>4</kbd> (Nochmal · Schwer · Gut · Einfach); <kbd>↵</kbd> übernimmt den Vorschlag.
   ⌘Z macht die letzte Bewertung rückgängig.

### Planung (SRS)

| Status | Nochmal | Schwer | Gut | Einfach |
|---|---|---|---|---|
| neu / lernen | <1 Min. | <10 Min. | 1 Tag | 4 Tage |
| wiederholen | → wieder lernen, Intervall halbiert, Ease −0,2 | Intervall × 1,2, Ease −0,15 | Intervall × Ease | Intervall × Ease × 1,3, Ease +0,15 |

Start-Ease 2,3, Minimum 1,3. Tages-Intervalle werden ab Mitternacht fällig. Neue Karten pro Tag: einstellbar (Standard 20).

## Daten

Alles liegt in `./data/database.json` (Karten + kompletter Lernverlauf). Jede Änderung wird atomar geschrieben:
`database.json.tmp` schreiben → `fsync` → `rename`. Beim Start entsteht zusätzlich `database.backup.json`; ist die
Hauptdatei beschädigt, wird automatisch aus `.tmp` bzw. Backup wiederhergestellt (die defekte Datei bleibt als
`database.corrupt-<zeit>.json` erhalten). Es kann immer nur eine Instanz der App laufen.

Kartenfelder: `German`, `Hint`, `English`, `Trap`, `Pattern`, `Transfer1`, `Transfer2`, `Rule`, `Alternative1`,
`Alternative2`, `tags`. Mit `[[…]]` markierst du Schlüsselteile (in `Trap` den Fehler).

Zusätzlich zum vorgegebenen Schema speichert die App `settings` (Neue Karten pro Tag, Hinweis automatisch zeigen)
auf oberster Ebene und pro Versuch `stateBefore`, damit das Tageslimit für neue Karten korrekt gezählt wird.

### Kartenverwaltung (Reiter „Karten“)

- **Suche** über `German`, `English`, `Rule`, `tags` und alle bisherigen Eingaben (`userInput`).
- **Filter:** Tag sowie Status (*Alle Karten*, *Sorgenkinder* = mind. 2× Nochmal/Schwer oder letzte Eingabe falsch,
  *Mit Fehlern* = mind. 1× nicht exakt, *Heute fällig*, *Noch nie geübt*).
- **Sortierung:** meiste Fehler, zuletzt geübt, längste Ø Denkzeit, Fälligkeit, neueste.
- **Tabelle:** Checkbox (⇧-Klick wählt einen Bereich), Satz + Tags, Versuche mit Bewertungen, letzte Eingabe
  (✅/❌, Fehler rot, Tooltip zeigt das Richtige), Fälligkeit, Aktionen 🔍 Verlauf · 📋 Einzel-Export · ✏️ Bearbeiten · 🗑️ Löschen
  (mit Rückgängig).
- **🔍 Verlauf ansehen:** alle Kartenfelder, SRS-Zustand und Timeline aller Versuche (`shownAt -> submittedAt`, Denkzeit,
  Diff, Bewertung).
- Beim Lernen kopiert **📋 Verlauf dieser Karte kopieren** (Rückseite) den Verlauf als Markdown, inklusive des gerade
  geprüften, noch unbewerteten Versuchs.

### KI-Export (⌘⇧K oder „🤖 KI-Export …“)

| Einstellung | Optionen |
|---|---|
| Umfang | ausgewählte Karten (Standard bei Auswahl) · Sorgenkinder & Karten mit Fehlern · alle mit ≥ 1 Versuch |
| Zeitraum | alle Zeiten · letzte 7 Tage · letzte 30 Tage |
| Kompression | Smart (1. + letzte 3 Versuche) · nur fehlerhafte + letzter · alle ungekürzt |

Die Größe (Zeichen und geschätzte Tokens ≈ Zeichen / 4) wird live angezeigt, ab 40.000 Zeichen erscheint eine Warnung.
Format A ist ein kompaktes Markdown (eine Zeile pro Versuch mit Fehlerpaaren wie `[in -> at]`), Format B ist JSON mit
den gefilterten Karten und ihrem (gekürzten) `history` plus `historyTotal`. Beide lassen sich kopieren oder speichern.
Versuchsnummern beziehen sich immer auf den gesamten Verlauf einer Karte; ausgelassene Versuche werden markiert.

### Vokabel-Speed-Drill (Reiter „Vokabeln“, ⌘4)

500 Wörter (`data/vocab-seed.json`: Kiefer-OP, Reise, Arzt & Klinik, Alltag, Satzverbindungen) werden beim ersten Öffnen
in die Datenbank übernommen. Deutsches Wort erscheint → **Leertaste** löst auf → **←** falsch / **→** richtig.
Die Wörter kommen quer durch alle Kategorien gemischt (die Kategorie wechselt bei jedem Wort), oft falsche Wörter öfter,
sicher gewusste seltener. Oben lässt sich auch eine einzelne Kategorie wählen.

**🗑️ Kenne ich** (Knopf zwischen Falsch und Richtig, Taste **↓** oder ⌘⌫) nimmt ein Wort dauerhaft aus dem Training. Außerdem verschwindet ein Wort automatisch, wenn du es **3× hintereinander innerhalb von 5 Sekunden auflöst und „Richtig“ drückst** (eine falsche oder langsame Antwort setzt die Serie zurück; unter „Gelöschte Wörter“ als „gelernt“ markiert). Es bleibt dauerhaft weg (auch nach Neustart),
lässt sich aber unter „Gelöschte Wörter“ einzeln oder gesammelt wiederherstellen; direkt nach dem Löschen gibt es „Rückgängig“.
Alles liegt in `db.vocab` (`items` mit Richtig/Falsch-Zählern, `removed`) und ist im Voll-Backup enthalten.

### Diktat-Markierung

Auf der Vorderseite markiert **🎤 Diktiert** (⌘D) den aktuellen Versuch als per Diktier-App gesprochen. Der Versuch
bekommt `inputMethod: "dictated"` (sonst `"typed"`; ältere Versuche zählen als getippt). Im Markdown-Export stehen
diktierte Versuche mit `🎤[DIKTIERT]`, die Kopfzeile erklärt die Markierung und nennt die Anzahl.

### Backup

Einstellungen → **Voll-Backup exportieren** speichert die komplette `database.json`. **Backup wiederherstellen** zeigt
vorher, wie viele Karten und Versuche aktuell und im Backup vorhanden sind, und sichert den aktuellen Stand als
`data/database.before-restore-<zeit>.json`.

### Import

**Karten → Importieren** (⌘I): JSON einfügen oder Datei wählen, also entweder ein Array von Karten oder ein Objekt mit
`"cards"`. Fehlende Felder (`id`, `createdAt`, `srs`, `history`) werden ergänzt, Duplikate (gleicher deutscher +
englischer Satz) übersprungen.

## Tastenkürzel

| Kürzel | Aktion |
|---|---|
| ↵ / ⌘↵ | prüfen / ohne Antwort aufdecken |
| ⌘⇧H | Hinweis zeigen |
| ⌘D | Versuch als diktiert markieren |
| 1–4, ↵ | bewerten, Vorschlag übernehmen |
| E | Karte bearbeiten |
| ⌘Z / ⌘⌥Z | letzte Bewertung rückgängig |
| ⌘1–5 | Lernen · Karten · Statistik · Vokabeln · Einstellungen |
| ⌘N / ⌘F / ⌘I / ⌘⇧E | neue Karte / suchen / importieren / Voll-Backup exportieren |
| ⌘⇧K | KI-Export (mit aktueller Auswahl) |

## Struktur

```
main.js            Electron-Hauptprozess: Fenster, Menü, atomares Speichern, Dialoge
preload.js         sichere IPC-Brücke (contextIsolation, sandbox)
src/index.html     Oberfläche
src/styles.css     Dark-Mode-Design
src/lib/           reine Logik (auch in Node testbar): diff.js, srs.js, markup.js, export.js
src/js/            Views: study, cards (Verwaltung), details, editor, aiexport, stats, settings + store/ui
test/              node:test-Tests
```

## Als App starten

`scripts/make-app.sh` erzeugt `Englischkartei.app` auf dem Desktop und in `/Applications`. Die App ist nur ein Starter
für diesen Projektordner (die Datenbank bleibt `data/database.json`); der Ordner darf deshalb nicht verschoben werden.
