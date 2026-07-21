'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 签名库：普通文件目录 + JSON 索引（红线 5 可直接拷贝备份）
 * library.json: {
 *   chars: { "甲": [{id,file,sourceWord,isDefault}] },
 *   words: { "甲乙丙": [{id,file,isDefault}] }
 * }
 * 合成时每字/词取 isDefault 的条目（无标记时取第 1 条）。
 */
class LibraryStore {
  constructor(userDir) {
    this.dir = userDir;
    this.indexPath = path.join(userDir, 'library.json');
    fs.mkdirSync(path.join(userDir, 'chars'), { recursive: true });
    fs.mkdirSync(path.join(userDir, 'words'), { recursive: true });
    this.index = this._load();
  }

  _load() {
    if (!fs.existsSync(this.indexPath)) return { chars: {}, words: {} };
    const idx = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
    return { chars: idx.chars || {}, words: idx.words || {} };
  }

  _save() {
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  /**
   * 将索引中的相对路径限制在当前用户签名库内。
   * 这同时保护旧索引的读取/删除，避免恶意 ../ 路径跨账号访问。
   */
  _entryPath(relativePath) {
    if (typeof relativePath !== 'string' || !relativePath) {
      throw new Error('签名库条目路径无效');
    }
    const root = path.resolve(this.dir);
    const resolved = path.resolve(root, relativePath);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('签名库条目路径越界');
    }
    return resolved;
  }

  _newEntry(kind) {
    const id = `${kind}_${crypto.randomUUID()}`;
    return { id, file: `${kind === 'word' ? 'words' : 'chars'}/${id}.png` };
  }

  _defaultEntry(entries) {
    if (!entries || !entries.length) return null;
    return entries.find((e) => e.isDefault) || entries[0];
  }

  /**
   * 入库一条签名：整词图 + 逐字图
   * @param {string} word 签名对应的词
   * @param {Buffer} wordPng 整词白底黑字 PNG
   * @param {Array<{char:string, png:Buffer}>} chars 逐字白底黑字 PNG
   */
  addSignature(word, wordPng, chars) {
    if (!word || !word.trim()) throw new Error('词语不能为空');
    word = word.trim();
    if (chars.length !== [...word].length) {
      throw new Error(`字数(${chars.length})与词「${word}」字数(${[...word].length})不一致`);
    }
    const now = new Date().toISOString();
    const wordEntries = this.index.words[word] || [];
    const wordAsset = this._newEntry('word');
    fs.writeFileSync(this._entryPath(wordAsset.file), wordPng);
    const wordEntry = { ...wordAsset, isDefault: wordEntries.length === 0, createdAt: now };
    this.index.words[word] = [...wordEntries, wordEntry];

    [...word].forEach((ch, i) => {
      const entries = this.index.chars[ch] || [];
      const asset = this._newEntry('char');
      fs.writeFileSync(this._entryPath(asset.file), chars[i].png);
      this.index.chars[ch] = [...entries, {
        ...asset, sourceWord: word, isDefault: entries.length === 0, createdAt: now,
      }];
    });
    this._save();
    return wordEntry;
  }

  /** 直接补录单字图 */
  addCharImage(ch, png) {
    if (!ch || [...ch].length !== 1) throw new Error('补录内容必须是单个汉字');
    const entries = this.index.chars[ch] || [];
    const asset = this._newEntry('char');
    fs.writeFileSync(this._entryPath(asset.file), png);
    this.index.chars[ch] = [...entries, {
      ...asset, sourceWord: '(单字补录)', isDefault: entries.length === 0, createdAt: new Date().toISOString(),
    }];
    this._save();
  }

  /** 查整词默认图，返回绝对路径或 null */
  getWordImage(word, variantIndex) {
    const entries = this.index.words[word];
    if (!entries || !entries.length) return null;
    const entry = variantIndex != null
      ? entries[variantIndex % entries.length]
      : this._defaultEntry(entries);
    const p = this._entryPath(entry.file);
    return fs.existsSync(p) ? p : null;
  }

  /** 查单字默认图，返回绝对路径或 null */
  getCharImage(ch, variantIndex) {
    const entries = this.index.chars[ch];
    if (!entries || !entries.length) return null;
    const entry = variantIndex != null
      ? entries[variantIndex % entries.length]
      : this._defaultEntry(entries);
    const p = this._entryPath(entry.file);
    return fs.existsSync(p) ? p : null;
  }

  /** 某词/字共有多少张备选图（预览页"换一张字图"用） */
  variantCount(type, key) {
    const entries = (type === 'word' ? this.index.words : this.index.chars)[key];
    return entries ? entries.length : 0;
  }

  /** 可视化列表：全部单字（含多张笔迹） */
  listChars() {
    return Object.entries(this.index.chars).map(([char, entries]) => ({
      char,
      entries: entries.map((e) => ({
        id: e.id,
        file: e.file,
        sourceWord: e.sourceWord,
        createdAt: e.createdAt || null,
        isDefault: this._defaultEntry(entries).id === e.id,
      })),
    }));
  }

  /** 可视化列表：全部整词 */
  listWords() {
    return Object.entries(this.index.words).map(([word, entries]) => ({
      word,
      entries: entries.map((e) => ({
        id: e.id,
        file: e.file,
        createdAt: e.createdAt || null,
        isDefault: this._defaultEntry(entries).id === e.id,
      })),
    }));
  }

  /** 读条目图片（列表缩略图用） */
  readEntry(type, key, id) {
    const entries = (type === 'word' ? this.index.words : this.index.chars)[key] || [];
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;
    const p = this._entryPath(entry.file);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  }

  /** 删除条目（含文件）；若删的是默认图，自动提升第 1 张为默认 */
  deleteEntry(type, key, id) {
    const bucket = type === 'word' ? this.index.words : this.index.chars;
    const entries = bucket[key] || [];
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error('条目不存在');
    const wasDefault = this._defaultEntry(entries).id === id;
    const filePath = this._entryPath(entries[idx].file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    entries.splice(idx, 1);
    if (!entries.length) {
      delete bucket[key];
    } else {
      entries.forEach((e) => { delete e.isDefault; });
      if (wasDefault) entries[0].isDefault = true;
      else this._defaultEntry(entries) && (this._defaultEntry(entries).isDefault = true);
      bucket[key] = entries;
    }
    this._save();
  }

  /** 设默认图 */
  setDefault(type, key, id) {
    const bucket = type === 'word' ? this.index.words : this.index.chars;
    const entries = bucket[key] || [];
    if (!entries.some((e) => e.id === id)) throw new Error('条目不存在');
    entries.forEach((e) => { e.isDefault = e.id === id; });
    this._save();
  }

  stats() {
    return {
      charCount: Object.keys(this.index.chars).length,
      wordCount: Object.keys(this.index.words).length,
      chars: Object.keys(this.index.chars),
      words: Object.keys(this.index.words),
    };
  }
}

module.exports = { LibraryStore };
