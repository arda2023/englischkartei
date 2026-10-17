'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadDb: () => ipcRenderer.invoke('db:load'),
  saveDb: (db) => ipcRenderer.invoke('db:save', db),
  dbPath: () => ipcRenderer.invoke('db:path'),
  revealDb: () => ipcRenderer.invoke('db:reveal'),
  importFile: () => ipcRenderer.invoke('file:import'),
  exportFile: (content, name) => ipcRenderer.invoke('file:export', content, name),
  vocabSeed: () => ipcRenderer.invoke('vocab:seed'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  restoreDb: () => ipcRenderer.invoke('db:restore'),
  confirm: (message, detail) => ipcRenderer.invoke('dialog:confirm', message, detail),
  onCommand: (callback) => ipcRenderer.on('command', (_event, command) => callback(command)),
});
