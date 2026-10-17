'use strict';

const { app, BrowserWindow, Menu, clipboard, ipcMain, dialog, nativeTheme, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.json');
const TMP_PATH = DB_PATH + '.tmp';
const BACKUP_PATH = path.join(DATA_DIR, 'database.backup.json');

const EMPTY_DB = { cards: [] };

// ---------------------------------------------------------------------------
// Persistenz
// ---------------------------------------------------------------------------

function isValidDb(db) {
  return db && typeof db === 'object' && Array.isArray(db.cards);
}

async function readJson(file) {
  const raw = await fsp.readFile(file, 'utf8');
  return JSON.parse(raw);
}

/**
 * Schreibt atomar: erst in eine .tmp-Datei, fsync, dann rename über das Original.
 * rename() ist auf demselben Dateisystem atomar – die Datenbank ist also zu jedem
 * Zeitpunkt entweder komplett alt oder komplett neu, nie halb geschrieben.
 */
async function atomicWrite(file, data) {
  const tmp = file === DB_PATH ? TMP_PATH : file + '.tmp';
  const handle = await fsp.open(tmp, 'w');
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(tmp, file);
  // Verzeichnis-Eintrag ebenfalls auf die Platte bringen.
  try {
    const dir = await fsp.open(path.dirname(file), 'r');
    await dir.sync();
    await dir.close();
  } catch {
    /* auf manchen Dateisystemen nicht unterstützt */
  }
}

/**
 * Lädt die Datenbank. Fallback-Reihenfolge: database.json -> .tmp (falls ein
 * Absturz zwischen write und rename passierte) -> Backup -> leere Datenbank.
 */
async function loadDb() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  for (const candidate of [DB_PATH, TMP_PATH, BACKUP_PATH]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const db = await readJson(candidate);
      if (isValidDb(db)) {
        if (candidate !== DB_PATH) {
          console.warn(`[db] database.json unbrauchbar, wiederhergestellt aus ${path.basename(candidate)}`);
          await atomicWrite(DB_PATH, JSON.stringify(db, null, 2));
        }
        return db;
      }
    } catch (err) {
      console.warn(`[db] ${path.basename(candidate)} konnte nicht gelesen werden:`, err.message);
      if (candidate === DB_PATH) {
        // Defekte Datei nicht überschreiben, sondern zur Analyse aufheben.
        const corrupt = path.join(DATA_DIR, `database.corrupt-${Date.now()}.json`);
        await fsp.copyFile(DB_PATH, corrupt).catch(() => {});
      }
    }
  }
  await atomicWrite(DB_PATH, JSON.stringify(EMPTY_DB, null, 2));
  return structuredClone(EMPTY_DB);
}

/** Einmal pro App-Start eine Sicherungskopie des letzten gültigen Stands anlegen. */
async function writeStartupBackup(db) {
  if (db.cards.length === 0) return;
  try {
    await atomicWrite(BACKUP_PATH, JSON.stringify(db, null, 2));
  } catch (err) {
    console.warn('[db] Backup fehlgeschlagen:', err.message);
  }
}

// Schreibvorgänge serialisieren, damit sich zwei rename()-Aufrufe nie überholen.
let writeChain = Promise.resolve();
function saveDb(db) {
  if (!isValidDb(db)) return Promise.reject(new Error('Ungültige Datenbankstruktur'));
  const json = JSON.stringify(db, null, 2);
  writeChain = writeChain.catch(() => {}).then(() => atomicWrite(DB_PATH, json));
  return writeChain;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('db:load', async () => {
    const db = await loadDb();
    await writeStartupBackup(db);
    return db;
  });

  ipcMain.handle('db:save', async (_event, db) => {
    await saveDb(db);
    return true;
  });

  ipcMain.handle('db:path', () => DB_PATH);

  // Mitgelieferte Vokabelliste (wird beim ersten Öffnen des Vokabel-Reiters in die Datenbank übernommen).
  ipcMain.handle('vocab:seed', async () => JSON.parse(await fsp.readFile(path.join(DATA_DIR, 'vocab-seed.json'), 'utf8')));

  ipcMain.handle('db:reveal', () => shell.showItemInFolder(DB_PATH));

  ipcMain.handle('file:import', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Karten importieren',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePaths.length) return null;
    return fsp.readFile(filePaths[0], 'utf8');
  });

  ipcMain.handle('file:export', async (event, content, suggestedName) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const name = suggestedName || 'englischkartei-export.json';
    const isMarkdown = /\.md$/i.test(name);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Exportieren',
      defaultPath: name,
      filters: [isMarkdown ? { name: 'Markdown', extensions: ['md'] } : { name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return null;
    await atomicWrite(filePath, content);
    return filePath;
  });

  ipcMain.handle('clipboard:write', (_event, text) => {
    clipboard.writeText(String(text ?? ''));
    return true;
  });

  // Backup wiederherstellen: Datei wählen, prüfen, bestätigen, aktuellen Stand sichern, ersetzen.
  ipcMain.handle('db:restore', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Backup wiederherstellen',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePaths.length) return null;

    let backup;
    try {
      backup = await readJson(filePaths[0]);
    } catch (err) {
      return { error: `Datei ist kein gültiges JSON: ${err.message}` };
    }
    if (!isValidDb(backup)) return { error: 'Die Datei enthält keine Datenbank (es fehlt das Array "cards").' };

    await writeChain.catch(() => {});
    const current = fs.existsSync(DB_PATH) ? await readJson(DB_PATH).catch(() => EMPTY_DB) : EMPTY_DB;
    const count = (db) => {
      const cards = db.cards.length;
      const attempts = db.cards.reduce((n, c) => n + (Array.isArray(c.history) ? c.history.length : 0), 0);
      return `${cards} Karten, ${attempts} Versuche`;
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safetyName = `database.before-restore-${stamp}.json`;
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Abbrechen', 'Wiederherstellen'],
      defaultId: 1,
      cancelId: 0,
      message: 'Backup wiederherstellen?',
      detail:
        `Aktuell: ${count(current)}\nBackup: ${count(backup)}\n\n` +
        `Alle aktuellen Daten werden durch das Backup ersetzt. Der aktuelle Stand wird vorher als ${safetyName} im data-Ordner gesichert.`,
    });
    if (response !== 1) return null;

    if (fs.existsSync(DB_PATH)) await fsp.copyFile(DB_PATH, path.join(DATA_DIR, safetyName));
    await saveDb(backup);
    return { db: backup, safetyName };
  });

  ipcMain.handle('dialog:confirm', async (event, message, detail) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Abbrechen', 'OK'],
      defaultId: 1,
      cancelId: 0,
      message,
      detail,
    });
    return response === 1;
  });
}

// ---------------------------------------------------------------------------
// Menü
// ---------------------------------------------------------------------------

function sendCommand(command) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send('command', command);
}

function buildMenu() {
  const cmd = (label, accelerator, command) => ({ label, accelerator, click: () => sendCommand(command) });
  const template = [
    { role: 'appMenu' },
    {
      label: 'Ablage',
      submenu: [
        cmd('Neue Karte', 'CmdOrCtrl+N', 'new-card'),
        { type: 'separator' },
        cmd('Karten importieren …', 'CmdOrCtrl+I', 'import'),
        cmd('Voll-Backup exportieren …', 'CmdOrCtrl+Shift+E', 'export'),
        cmd('Backup wiederherstellen …', undefined, 'restore'),
        { type: 'separator' },
        cmd('KI-Export …', 'CmdOrCtrl+Shift+K', 'ai-export'),
        { type: 'separator' },
        { label: 'Datenbank im Finder zeigen', click: () => shell.showItemInFolder(DB_PATH) },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      // Eigenes Widerrufen: im Textfeld normales Undo, sonst letzte Bewertung rückgängig.
      label: 'Bearbeiten',
      submenu: [
        cmd('Widerrufen', 'CmdOrCtrl+Z', 'undo'),
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Darstellung',
      submenu: [
        cmd('Lernen', 'CmdOrCtrl+1', 'view-study'),
        cmd('Karten', 'CmdOrCtrl+2', 'view-cards'),
        cmd('Statistik', 'CmdOrCtrl+3', 'view-stats'),
        cmd('Vokabeln', 'CmdOrCtrl+4', 'view-vocab'),
        cmd('Einstellungen', 'CmdOrCtrl+5', 'view-settings'),
        { type: 'separator' },
        cmd('Karten durchsuchen', 'CmdOrCtrl+F', 'find'),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'reload' }, { role: 'toggleDevTools' }]),
      ],
    },
    {
      label: 'Lernen',
      submenu: [cmd('Letzte Bewertung rückgängig', 'CmdOrCtrl+Alt+Z', 'undo-rating')],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Fenster
// ---------------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 860,
    minWidth: 900,
    minHeight: 780,
    title: 'Englischkartei',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#141414',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Externe Links nie im App-Fenster öffnen.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.setName('Englischkartei');

// Nur eine Instanz: zwei Prozesse dürfen nie gleichzeitig dieselbe Datenbank schreiben.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  registerIpc();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Ausstehende Schreibvorgänge vor dem Beenden abschließen.
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  // Erneutes quit() erst im nächsten Tick – innerhalb des laufenden Quit-Vorgangs würde es ignoriert.
  writeChain.catch(() => {}).finally(() => setTimeout(() => app.quit(), 0));
});
