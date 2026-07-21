'use strict';

/* 建库页：逐字画框录入 + 字体库可视列表（删除/设默认/补单字） */
window.LibraryView = {
  analysis: null, // { filePath, word, width, height, photoDataUrl }
  boxes: [],      // 已确认框（原图坐标）
  canvas: null,
  scale: 1,
  libData: null,          // 最近一次 lib.list() 结果
  query: '',              // 搜索关键词
  sortBy: 'pinyin',       // pinyin | time | count
  filterMulti: 'all',     // all | multi | single
  tab: 'char',            // char | word

  async mount(container, ctx) {
    this.ctx = ctx;
    this.analysis = null;
    this.boxes = [];
    container.innerHTML = `
      <div class="panel">
        <h2>录入签名</h2>
        <div class="row">
          <input type="text" id="sign-word" placeholder="签名对应的词，如：甲乙丙" />
          <button class="primary" id="pick-photo">选择签名照片</button>
          <button class="ghost hidden" id="undo-box">撤销上一框</button>
          <button class="primary hidden" id="confirm-import">确认入库</button>
        </div>
        <p id="box-hint" style="font-size:13px;color:#1a73e8;margin:10px 0 0"></p>
        <div id="cut-area"></div>
        <div id="import-preview" class="preview-strip"></div>
      </div>
      <div class="panel">
        <h2>补录单字</h2>
        <div class="row">
          <input type="text" id="add-char-input" placeholder="输入单个汉字，如：伟" maxlength="2" style="width:180px" />
          <button class="ghost" id="add-char-btn">上传该字图片</button>
        </div>
      </div>
      <div class="panel">
        <h2>字体库</h2>
        <div id="lib-list"></div>
      </div>`;

    container.querySelector('#pick-photo').onclick = () => this.analyze(container);
    container.querySelector('#undo-box').onclick = () => this.undoBox(container);
    container.querySelector('#confirm-import').onclick = () => this.confirm(container);
    container.querySelector('#add-char-btn').onclick = () => this.addChar(container);
    await this.renderList(container);
  },

  async analyze(container) {
    const word = container.querySelector('#sign-word').value.trim();
    if (!word) return this.ctx.toast('请先输入签名对应的词');
    const res = await window.api.lib.analyze(word);
    if (!res) return;
    this.analysis = res;
    this.boxes = [];
    this.renderCanvas(container);
  },

  renderCanvas(container) {
    const a = this.analysis;
    const area = container.querySelector('#cut-area');
    const maxW = Math.min(900, window.innerWidth - 120);
    this.scale = Math.min(1, maxW / a.width);
    const dispW = Math.round(a.width * this.scale);
    const dispH = Math.round(a.height * this.scale);

    area.innerHTML = `<canvas id="box-canvas" width="${dispW}" height="${dispH}"></canvas>`;
    const canvas = area.querySelector('#box-canvas');
    this.canvas = canvas;
    const img = new Image();
    img.onload = () => {
      this.photo = img;
      this.redraw();
    };
    img.src = a.photoDataUrl;

    let dragStart = null;
    let dragNow = null;
    canvas.onmousedown = (e) => {
      if (this.boxes.length >= [...a.word].length) return;
      dragStart = this._pos(e);
      dragNow = dragStart;
    };
    canvas.onmousemove = (e) => {
      if (!dragStart) return;
      dragNow = this._pos(e);
      this.redraw({ x0: dragStart.x, y0: dragStart.y, x1: dragNow.x, y1: dragNow.y });
    };
    canvas.onmouseup = (e) => {
      if (!dragStart) return;
      dragNow = this._pos(e);
      const rect = this._normalize(dragStart, dragNow);
      dragStart = null;
      if (rect.width > 4 && rect.height > 4) {
        this.boxes.push(rect);
        this.redraw();
        this._updateHint(container);
      } else {
        this.redraw();
      }
    };
    this._updateHint(container);
  },

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  },

  _normalize(p, q) {
    // 显示坐标 → 原图坐标
    const left = Math.min(p.x, q.x) / this.scale;
    const top = Math.min(p.y, q.y) / this.scale;
    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(Math.abs(q.x - p.x) / this.scale),
      height: Math.round(Math.abs(q.y - p.y) / this.scale),
    };
  },

  redraw(dragRect) {
    if (!this.canvas || !this.photo) return;
    const ctx2d = this.canvas.getContext('2d');
    ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx2d.drawImage(this.photo, 0, 0, this.canvas.width, this.canvas.height);
    const chars = [...this.analysis.word];
    // 已确认框
    this.boxes.forEach((b, i) => {
      const x = b.left * this.scale;
      const y = b.top * this.scale;
      const w = b.width * this.scale;
      const h = b.height * this.scale;
      ctx2d.strokeStyle = '#1a73e8';
      ctx2d.lineWidth = 2;
      ctx2d.strokeRect(x, y, w, h);
      ctx2d.fillStyle = '#1a73e8';
      ctx2d.font = '12px sans-serif';
      ctx2d.fillText(`${i + 1}.${chars[i]}`, x + 3, y + 14);
    });
    // 拖拽中的框
    if (dragRect) {
      ctx2d.strokeStyle = '#e8453c';
      ctx2d.setLineDash([4, 3]);
      ctx2d.lineWidth = 1.5;
      ctx2d.strokeRect(
        Math.min(dragRect.x0, dragRect.x1), Math.min(dragRect.y0, dragRect.y1),
        Math.abs(dragRect.x1 - dragRect.x0), Math.abs(dragRect.y1 - dragRect.y0));
      ctx2d.setLineDash([]);
    }
  },

  _updateHint(container) {
    const chars = [...this.analysis.word];
    const n = this.boxes.length;
    const hint = container.querySelector('#box-hint');
    if (n >= chars.length) {
      hint.textContent = '全部字已框完，确认无误后点"确认入库"；画错可撤销上一框。';
    } else {
      hint.textContent = `请拖鼠标框选第 ${n + 1} 个字：「${chars[n]}」（已框 ${n}/${chars.length}）`;
    }
    container.querySelector('#undo-box').classList.toggle('hidden', n === 0);
    container.querySelector('#confirm-import').classList.toggle('hidden', n < chars.length);
  },

  undoBox(container) {
    this.boxes.pop();
    this.redraw();
    this._updateHint(container);
  },

  async confirm(container) {
    const a = this.analysis;
    if (!a) return;
    try {
      const res = await window.api.lib.confirm({ word: a.word, boxes: this.boxes });
      const strip = container.querySelector('#import-preview');
      strip.innerHTML =
        res.charPreviews.map((p) => `
          <div class="preview-item"><img src="${window.safeHtml(p.dataUrl)}" /><span>${window.safeHtml(p.char)}</span></div>`).join('') +
        `<div class="preview-item"><img src="${window.safeHtml(res.wordPreview)}" /><span>整词：${window.safeHtml(a.word)}</span></div>`;
      this.ctx.toast(`「${a.word}」已入库`);
      this.analysis = null;
      this.boxes = [];
      container.querySelector('#cut-area').innerHTML = '';
      container.querySelector('#box-hint').textContent = '';
      container.querySelector('#confirm-import').classList.add('hidden');
      container.querySelector('#undo-box').classList.add('hidden');
      container.querySelector('#sign-word').value = '';
      await this.renderList(container);
    } catch (err) {
      this.ctx.toast(`入库失败：${err.message}`);
    }
  },

  async addChar(container) {
    const ch = container.querySelector('#add-char-input').value.trim();
    if ([...ch].length !== 1) return this.ctx.toast('请输入单个汉字');
    const res = await window.api.lib.addChar(ch);
    if (!res) return;
    this.ctx.toast(`「${ch}」已补录入库`);
    container.querySelector('#add-char-input').value = '';
    await this.renderList(container);
  },

  async renderList(container) {
    this.libData = await window.api.lib.list();
    this.paintList(container);
  },

  /** 依据 query/sortBy/filterMulti/tab 过滤+排序，画出表格列表（纯前端，不再请求主进程） */
  paintList(container) {
    const el = container.querySelector('#lib-list');
    const data = this.libData || { chars: [], words: [] };
    const type = this.tab;
    const groups = type === 'char' ? data.chars : data.words;
    const esc = window.safeHtml;

    const q = this.query.trim().toLowerCase();
    const matched = groups.filter((g) => {
      if (this.filterMulti === 'multi' && g.count <= 1) return false;
      if (this.filterMulti === 'single' && g.count > 1) return false;
      if (!q) return true;
      const srcWords = g.entries.map((e) => e.sourceWord || '').join(' ');
      return (
        String(g.key).toLowerCase().includes(q) ||
        (g.pinyin || '').toLowerCase().includes(q) ||
        (g.initial || '').toLowerCase().includes(q) ||
        srcWords.toLowerCase().includes(q)
      );
    });

    const latest = (g) => g.entries.reduce((m, e) => (e.createdAt && e.createdAt > m ? e.createdAt : m), '');
    matched.sort((a, b) => {
      if (this.sortBy === 'count') return b.count - a.count || (a.pinyin || '').localeCompare(b.pinyin || '');
      if (this.sortBy === 'time') return (latest(b) || '').localeCompare(latest(a) || '');
      return (a.pinyin || '').localeCompare(b.pinyin || '') || String(a.key).localeCompare(String(b.key));
    });

    const fmtTime = (iso) => (iso ? iso.slice(0, 10) : '—');
    const rows = matched.map((g) => {
      const src = type === 'char'
        ? [...new Set(g.entries.map((e) => e.sourceWord).filter((s) => s && s !== '(单字补录)'))].join('、') || '—'
        : '—';
      const multiBadge = g.count > 1 ? `<span class="multi-badge">多图</span>` : '';
      // 多张笔迹：主行显示默认图，展开行显示每张的设默认/删除
      const entriesHtml = g.entries.map((e) => `
        <div class="entry-chip ${e.isDefault ? 'is-default' : ''}">
          <img src="${esc(e.dataUrl)}" />
          <div class="entry-chip-ops">
            ${e.isDefault ? '<span class="default-badge">默认</span>'
              : `<button class="op-btn" data-act="default" data-type="${esc(type)}" data-key="${esc(g.key)}" data-id="${esc(e.id)}">设默认</button>`}
            <button class="op-btn danger" data-act="delete" data-type="${esc(type)}" data-key="${esc(g.key)}" data-id="${esc(e.id)}">删</button>
          </div>
        </div>`).join('');
      const def = g.entries.find((e) => e.isDefault) || g.entries[0];
      return `
      <tr class="lib-row" data-key="${esc(g.key)}">
        <td class="col-thumb"><img src="${esc(def.dataUrl)}" /></td>
        <td class="col-key">${esc(g.key)} ${multiBadge}</td>
        <td class="col-pinyin">${esc(g.pinyin || '—')}<span class="col-initial">${esc(g.initial || '')}</span></td>
        <td class="col-src">${esc(src)}</td>
        <td class="col-count">${g.count}</td>
        <td class="col-time">${esc(fmtTime(latest(g)))}</td>
        <td class="col-ops"><button class="op-btn expand-btn">管理图</button></td>
      </tr>
      <tr class="lib-entries-row hidden" data-key="${esc(g.key)}"><td colspan="7"><div class="entries-wrap">${entriesHtml}</div></td></tr>`;
    }).join('');

    el.innerHTML = `
      <div class="lib-toolbar">
        <div class="seg">
          <button class="seg-btn ${type === 'char' ? 'active' : ''}" data-tab="char">单字（${data.chars.length}）</button>
          <button class="seg-btn ${type === 'word' ? 'active' : ''}" data-tab="word">整词（${data.words.length}）</button>
        </div>
        <input type="text" id="lib-search" placeholder="搜字 / 拼音 / 首字母 / 来源词" value="${esc(this.query)}" style="min-width:220px" />
        <label class="tb-label">排序
          <select id="lib-sort">
            <option value="pinyin" ${this.sortBy === 'pinyin' ? 'selected' : ''}>拼音</option>
            <option value="time" ${this.sortBy === 'time' ? 'selected' : ''}>入库时间</option>
            <option value="count" ${this.sortBy === 'count' ? 'selected' : ''}>张数</option>
          </select>
        </label>
        <label class="tb-label">过滤
          <select id="lib-filter">
            <option value="all" ${this.filterMulti === 'all' ? 'selected' : ''}>全部</option>
            <option value="multi" ${this.filterMulti === 'multi' ? 'selected' : ''}>仅多图</option>
            <option value="single" ${this.filterMulti === 'single' ? 'selected' : ''}>仅单图</option>
          </select>
        </label>
        <span class="tb-count">${matched.length} 条</span>
      </div>
      ${matched.length ? `
      <table class="lib-table">
        <thead><tr>
          <th class="col-thumb">缩略图</th><th>${type === 'char' ? '字' : '词'}</th>
          <th>拼音</th><th>来源词</th><th>张数</th><th>入库时间</th><th>操作</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>` : `<p class="lib-empty">${this.query ? '没有匹配的条目' : (type === 'char' ? '暂无单字' : '暂无整词')}</p>`}`;

    // 工具栏事件
    const search = el.querySelector('#lib-search');
    search.oninput = (e) => {
      this.query = e.target.value;
      const pos = e.target.selectionStart;
      this.paintList(container);
      const s = container.querySelector('#lib-search');
      s.focus();
      s.setSelectionRange(pos, pos);
    };
    el.querySelector('#lib-sort').onchange = (e) => { this.sortBy = e.target.value; this.paintList(container); };
    el.querySelector('#lib-filter').onchange = (e) => { this.filterMulti = e.target.value; this.paintList(container); };
    el.querySelectorAll('.seg-btn').forEach((b) => {
      b.onclick = () => { this.tab = b.dataset.tab; this.paintList(container); };
    });
    // 展开/收起某条的多张笔迹管理
    el.querySelectorAll('.expand-btn').forEach((btn) => {
      btn.onclick = () => {
        const key = btn.closest('.lib-row').dataset.key;
        const detail = el.querySelector(`.lib-entries-row[data-key="${CSS.escape(key)}"]`);
        if (detail) detail.classList.toggle('hidden');
      };
    });
    // 设默认 / 删除
    el.querySelectorAll('.op-btn[data-act]').forEach((btn) => {
      btn.onclick = async () => {
        const { act, type: t, key, id } = btn.dataset;
        try {
          if (act === 'delete') {
            await window.api.lib.deleteEntry({ type: t, key, id });
            this.ctx.toast(`已删除「${key}」的一张图`);
          } else {
            await window.api.lib.setDefault({ type: t, key, id });
            this.ctx.toast(`已设「${key}」的默认图`);
          }
          await this.renderList(container);
        } catch (err) {
          this.ctx.toast(err.message);
        }
      };
    });
  },
};
