'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  users: {
    login: (payload) => ipcRenderer.invoke('users:login', payload),
    register: (payload) => ipcRenderer.invoke('users:register', payload),
    logout: () => ipcRenderer.invoke('users:logout'),
    current: () => ipcRenderer.invoke('users:current'),
  },
  lib: {
    stats: () => ipcRenderer.invoke('lib:stats'),
    list: () => ipcRenderer.invoke('lib:list'),
    deleteEntry: (payload) => ipcRenderer.invoke('lib:deleteEntry', payload),
    setDefault: (payload) => ipcRenderer.invoke('lib:setDefault', payload),
    addChar: (ch) => ipcRenderer.invoke('lib:addChar', ch),
    analyze: (word) => ipcRenderer.invoke('import:analyze', word),
    confirm: (payload) => ipcRenderer.invoke('import:confirm', payload),
  },
  xlsx: {
    open: () => ipcRenderer.invoke('xlsx:open'),
    setCell: (payload) => ipcRenderer.invoke('xlsx:setCell', payload),
    compose: (targets) => ipcRenderer.invoke('xlsx:compose', targets),
    updateSignature: (payload) => ipcRenderer.invoke('xlsx:updateSignature', payload),
    deleteSignature: (payload) => ipcRenderer.invoke('xlsx:deleteSignature', payload),
    export: () => ipcRenderer.invoke('xlsx:export'),
  },
});
