'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { UserStore } = require('./users');
const { LibraryStore } = require('./library');
const image = require('./image');
const { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, assertFileSize } = require('./file-limits');
const { SessionGuard } = require('./session-guard');
const { XlsxDoc, defaultOutPath } = require('./xlsx');
const { pinyin } = require('pinyin-pro');

/** 汉字串 → { full: "zhang san", initial: "zsf" }（离线，检索用） */
function pinyinOf(text) {
  try {
    return {
      full: pinyin(text, { toneType: 'none', type: 'array' }).join(' '),
      initial: pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' }).join(''),
    };
  } catch (_) {
    return { full: '', initial: '' };
  }
}

// 运行时状态
let userStore;
let currentUser = null;   // profile
let currentLib = null;    // LibraryStore
let currentDoc = null;    // XlsxDoc
let mainWindow = null;
const sessionGuard = new SessionGuard();

function dataRoot() {
  return path.join(app.getPath('userData'), 'userData');
}

function requireLib() {
  if (!currentLib) throw new Error('请先选择用户');
  return currentLib;
}
function requireDoc() {
  if (!currentDoc) throw new Error('请先打开表格文件');
  return currentDoc;
}

function captureSession({ requireDocument = false } = {}) {
  return {
    token: sessionGuard.capture(),
    lib: requireLib(),
    doc: requireDocument ? requireDoc() : currentDoc,
  };
}

function assertSession(session) {
  sessionGuard.assert(session.token);
  if (
    session.lib !== currentLib ||
    (session.doc && session.doc !== currentDoc)
  ) {
    throw new Error('用户会话已切换，请重新执行操作');
  }
}

async function readApprovedImage(filePath) {
  assertFileSize(filePath, MAX_IMAGE_BYTES, '图片文件');
  const buf = await fs.promises.readFile(filePath);
  const meta = await require('sharp')(buf, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  if (!meta.width || !meta.height || meta.width * meta.height > MAX_IMAGE_PIXELS) {
    throw new Error('图片像素尺寸过大或无法识别');
  }
  return { buf, meta };
}

function registerIpc() {
  // ---------- 用户（账号 + 密码登录）----------
  const enter = (profile) => {
    sessionGuard.enter(profile.id);
    currentUser = profile;
    currentLib = new LibraryStore(userStore.userDir(profile.id));
    currentDoc = null;
    return { profile, stats: currentLib.stats() };
  };
  ipcMain.handle('users:login', (_e, { account, password }) => enter(userStore.login(account, password)));
  ipcMain.handle('users:register', (_e, { account, name, password }) => enter(userStore.create({ account, name, password })));
  ipcMain.handle('users:logout', () => {
    sessionGuard.leave();
    currentUser = null;
    currentLib = null;
    currentDoc = null;
  });
  ipcMain.handle('users:current', () => ({
    profile: currentUser,
    stats: currentLib ? currentLib.stats() : null,
  }));

  // ---------- 建库 ----------
  // 选择签名照片（画框在渲染进程完成，主进程只给图和尺寸）
  ipcMain.handle('import:analyze', async (_e, word) => {
    const session = captureSession();
    const chars = [...(word || '').trim()];
    if (!chars.length) throw new Error('请先输入签名对应的词');
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '选择签名照片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return null;
    assertSession(session);
    const filePath = filePaths[0];
    const { buf, meta } = await readApprovedImage(filePath);
    assertSession(session);
    sessionGuard.approveImport(session.token, { filePath, word: chars.join('') });
    return {
      word: chars.join(''),
      width: meta.width,
      height: meta.height,
      photoDataUrl: `data:image/png;base64,${buf.toString('base64')}`,
    };
  });

  // 确认画框：逐框裁字 + 整词（各框并集区域）入库，返回单字预览
  ipcMain.handle('import:confirm', async (_e, { word, boxes }) => {
    const session = captureSession();
    const lib = session.lib;
    const chars = [...(word || '').trim()];
    const approved = sessionGuard.consumeImport(session.token, chars.join(''));
    if (!boxes || boxes.length !== chars.length) {
      throw new Error(`需要 ${chars.length} 个框，当前 ${boxes ? boxes.length : 0} 个`);
    }
    const { buf } = await readApprovedImage(approved.filePath);
    assertSession(session);
    const charPngs = [];
    for (const rect of boxes) {
      charPngs.push(await image.cropRegion(buf, rect));
      assertSession(session);
    }
    // 整词区域 = 所有框的并集
    const left = Math.min(...boxes.map((b) => b.left));
    const top = Math.min(...boxes.map((b) => b.top));
    const right = Math.max(...boxes.map((b) => b.left + b.width));
    const bottom = Math.max(...boxes.map((b) => b.top + b.height));
    const wordPng = await image.cropRegion(buf, {
      left, top, width: right - left, height: bottom - top,
    });
    assertSession(session);
    lib.addSignature(chars.join(''), wordPng, chars.map((ch, i) => ({ char: ch, png: charPngs[i] })));
    return {
      stats: lib.stats(),
      charPreviews: charPngs.map((png, i) => ({ char: chars[i], dataUrl: image.toDataUrl(png) })),
      wordPreview: image.toDataUrl(wordPng),
    };
  });

  ipcMain.handle('lib:stats', () => requireLib().stats());

  // 可视化列表（含缩略图 + 拼音 + 张数）
  ipcMain.handle('lib:list', () => {
    const lib = requireLib();
    const decorate = (type, keyField) => (group) => {
      const key = group[keyField];
      const py = pinyinOf(key);
      return {
        ...group,
        key,
        pinyin: py.full,
        initial: py.initial,
        count: group.entries.length,
        entries: group.entries.map((e) => ({
          ...e,
          dataUrl: image.toDataUrl(lib.readEntry(type, key, e.id)),
        })),
      };
    };
    return {
      chars: lib.listChars().map(decorate('char', 'char')),
      words: lib.listWords().map(decorate('word', 'word')),
    };
  });

  ipcMain.handle('lib:deleteEntry', (_e, { type, key, id }) => {
    const lib = requireLib();
    lib.deleteEntry(type, key, id);
    return lib.stats();
  });

  ipcMain.handle('lib:setDefault', (_e, { type, key, id }) => {
    requireLib().setDefault(type, key, id);
  });

  // 直接上传单字图补库
  ipcMain.handle('lib:addChar', async (_e, ch) => {
    const session = captureSession();
    const lib = session.lib;
    if (!ch || [...ch].length !== 1) throw new Error('请输入单个汉字');
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: `选择「${ch}」的单字图片`,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return null;
    assertSession(session);
    const { buf } = await readApprovedImage(filePaths[0]);
    assertSession(session);
    const bin = await image.binarize(buf);
    assertSession(session);
    const { png } = await image.trimWhite(bin);
    assertSession(session);
    lib.addCharImage(ch, png);
    return { stats: lib.stats(), dataUrl: image.toDataUrl(png) };
  });

  // ---------- 工作区 ----------
  ipcMain.handle('xlsx:open', async () => {
    const session = captureSession();
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '打开 xlsx 表格',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return null;
    assertSession(session);
    const doc = new XlsxDoc();
    const grid = await doc.open(filePaths[0]);
    assertSession(session);
    currentDoc = doc;
    return grid;
  });

  ipcMain.handle('xlsx:setCell', (_e, { row, col, value }) => {
    requireDoc().setCell(row, col, value);
  });

  // 就地合成选中格签名（存入 doc.items，不写文件）
  ipcMain.handle('xlsx:compose', async (_e, targets) => {
    const session = captureSession({ requireDocument: true });
    const { doc, lib } = session;
    const items = await doc.compose(targets, lib);
    assertSession(session);
    if (!items.length) throw new Error('选中的单元格里没有可合成的文字');
    return items;
  });

  // 调整一张签名：box（手动缩放/移动）/ align / cycleVariant / regenerate
  ipcMain.handle('xlsx:updateSignature', async (_e, payload) => {
    const session = captureSession({ requireDocument: true });
    const result = await session.doc.updateSignature(payload, session.lib);
    assertSession(session);
    return result;
  });

  ipcMain.handle('xlsx:deleteSignature', (_e, { row, col }) => {
    requireDoc().deleteSignature(row, col);
  });

  // 统一导出
  ipcMain.handle('xlsx:export', async () => {
    const session = captureSession({ requireDocument: true });
    const { doc } = session;
    if (!doc.hasItems()) throw new Error('没有待导出的合成结果，请先合成签名');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出合成结果',
      defaultPath: defaultOutPath(doc.filePath),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return null;
    assertSession(session);
    if (path.resolve(filePath) === path.resolve(doc.filePath)) {
      throw new Error('不允许覆盖原文件（红线 3），请换一个文件名');
    }
    const results = doc.results();
    await doc.writeItems(filePath);
    assertSession(session);
    return { outPath: filePath, results };
  });
}

function createWindow() {
  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  const rendererUrl = pathToFileURL(rendererPath).href;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    title: '人工签名合成',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl) event.preventDefault();
  });
  mainWindow.loadFile(rendererPath);
}

app.whenReady().then(() => {
  userStore = new UserStore(dataRoot());
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
