'use strict';

class SessionGuard {
  constructor() {
    this.generation = 0;
    this.userId = null;
    this.pendingImport = null;
  }

  enter(userId) {
    this.generation += 1;
    this.userId = userId;
    this.pendingImport = null;
  }

  leave() {
    this.generation += 1;
    this.userId = null;
    this.pendingImport = null;
  }

  capture() {
    if (!this.userId) throw new Error('请先选择用户');
    return { generation: this.generation, userId: this.userId };
  }

  assert(token) {
    if (!token || token.generation !== this.generation || token.userId !== this.userId) {
      throw new Error('用户会话已切换，请重新执行操作');
    }
  }

  approveImport(token, payload) {
    this.assert(token);
    this.pendingImport = { ...payload, generation: token.generation, userId: token.userId };
  }

  consumeImport(token, word) {
    this.assert(token);
    const approved = this.pendingImport;
    this.pendingImport = null;
    if (
      !approved || approved.word !== word ||
      approved.generation !== token.generation || approved.userId !== token.userId
    ) {
      throw new Error('签名图片确认已失效，请重新选择图片');
    }
    return approved;
  }
}

module.exports = { SessionGuard };
