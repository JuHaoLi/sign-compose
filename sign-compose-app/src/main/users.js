'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** 盐 + scrypt 派生（密码不明文落盘） */
function derive(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

/**
 * 用户管理：账号 + 密码登录，每账号一个独立目录（红线 6 多用户隔离）
 * userData/users/<id>/{profile.json, library.json, chars/, words/}
 * profile.json: { id, account, name, salt, passwordHash, createdAt }
 */
class UserStore {
  constructor(baseDir) {
    this.usersDir = path.join(baseDir, 'users');
    fs.mkdirSync(this.usersDir, { recursive: true });
  }

  /** 内部：读全部完整 profile（含 salt/hash） */
  _allProfiles() {
    const out = [];
    for (const entry of fs.readdirSync(this.usersDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const profilePath = path.join(this.usersDir, entry.name, 'profile.json');
      if (!fs.existsSync(profilePath)) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(profilePath, 'utf8')));
      } catch (_) { /* 跳过损坏的用户目录 */ }
    }
    return out;
  }

  /** 对外脱敏（去掉 salt/hash） */
  _public(p) {
    if (!p) return null;
    const { salt, passwordHash, ...pub } = p;
    return pub;
  }

  list() {
    return this._allProfiles()
      .map((p) => this._public(p))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  findByAccount(account) {
    const acc = String(account || '').trim().toLowerCase();
    return this._allProfiles().find((p) => (p.account || '').toLowerCase() === acc) || null;
  }

  /** 注册新账号；account 唯一 */
  create({ account, name, password }) {
    account = String(account || '').trim();
    name = String(name || '').trim();
    password = String(password || '');
    if (!account) throw new Error('账号不能为空');
    if (account.length > 64) throw new Error('账号最多 64 个字符');
    if (password.length < 8) throw new Error('密码至少需要 8 个字符');
    if (password.length > 128) throw new Error('密码最多 128 个字符');
    if (this.findByAccount(account)) throw new Error('账号已存在');
    const id = crypto.randomBytes(4).toString('hex');
    const dir = path.join(this.usersDir, id);
    fs.mkdirSync(path.join(dir, 'chars'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'words'), { recursive: true });
    const salt = crypto.randomBytes(16).toString('hex');
    const profile = {
      id,
      account,
      name: name || account,
      salt,
      passwordHash: derive(password, salt),
      createdAt: Date.now(),
    };
    fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(profile, null, 2));
    fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ chars: {}, words: {} }, null, 2));
    return this._public(profile);
  }

  /** 账号 + 密码校验，成功返回脱敏 profile */
  login(account, password) {
    const p = this.findByAccount(account);
    const fail = new Error('账号或密码错误');
    if (!p || !p.passwordHash || !p.salt) throw fail;
    const h = derive(password, p.salt);
    const a = Buffer.from(h, 'hex');
    const b = Buffer.from(p.passwordHash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw fail;
    return this._public(p);
  }

  get(id) {
    const profilePath = path.join(this.usersDir, id, 'profile.json');
    if (!fs.existsSync(profilePath)) return null;
    return this._public(JSON.parse(fs.readFileSync(profilePath, 'utf8')));
  }

  userDir(id) {
    const dir = path.join(this.usersDir, id);
    if (!fs.existsSync(path.join(dir, 'profile.json'))) throw new Error(`用户不存在: ${id}`);
    return dir;
  }
}

module.exports = { UserStore };
