'use strict';

/*
 * 工作区：打开 xlsx → 最大还原富表格 → 就地合成签名（文字变签名图）
 * → 继续编辑/再合成/调整签名（拖拽手柄缩放 + 右键菜单）→ 导出另存
 */
window.WorkspaceView = {
  grid: null,
  selected: new Set(),        // "r,c" 待合成
  signatures: new Map(),      // "r,c" → 已放签名项（主进程回传的 decorated item）
  selectedSig: null,          // 当前选中的签名 key
  zoom: 1,

  async mount(container, ctx) {
    this.ctx = ctx;
    this.grid = null;
    this.selected = new Set();
    this.signatures = new Map();
    this.selectedSig = null;
    this.zoom = 1;
    container.innerHTML = `
      <div class="panel">
        <div class="row">
          <button class="primary" id="open-xlsx">打开表格</button>
          <button class="primary hidden" id="compose-btn">合成选中单元格签名</button>
          <button class="ghost hidden" id="export-btn">全部确认，导出</button>
          <label class="tb-label hidden" id="zoom-wrap">缩放
            <input type="range" id="zoom" min="30" max="150" step="5" value="100" style="width:120px" />
            <span id="zoom-val">100%</span>
          </label>
          <span id="file-label" style="font-size:13px;color:#666"></span>
        </div>
        <p style="font-size:12px;color:#888;margin:10px 0 0" id="ws-hint">
          单击单元格=选中/取消（蓝框待合成）；双击进入编辑，点别处保存。合成后文字就地变签名图，
          点签名可拖角缩放、拖动位置、右键换图/重生成/删除；导出为新文件，原表不改。
        </p>
      </div>
      <div class="panel hidden" id="stage-panel">
        <div id="stage"><div id="stage-inner"></div></div>
        <div id="result-list"></div>
      </div>`;

    container.querySelector('#open-xlsx').onclick = () => this.openFile(container);
    container.querySelector('#compose-btn').onclick = () => this.compose(container);
    container.querySelector('#export-btn').onclick = () => this.export(container);
    const zoom = container.querySelector('#zoom');
    zoom.oninput = (e) => {
      this.zoom = Number(e.target.value) / 100;
      container.querySelector('#zoom-val').textContent = `${e.target.value}%`;
      this.applyZoom(container);
    };
    if (!this._menuCloser) {
      this._menuCloser = () => this.closeMenu();
      document.addEventListener('click', this._menuCloser);
    }
  },

  async openFile(container) {
    const grid = await window.api.xlsx.open();
    if (!grid) return;
    this.grid = grid;
    this.selected.clear();
    this.signatures.clear();
    this.selectedSig = null;
    container.querySelector('#file-label').textContent = grid.filePath;
    container.querySelector('#compose-btn').classList.remove('hidden');
    container.querySelector('#export-btn').classList.remove('hidden');
    container.querySelector('#zoom-wrap').classList.remove('hidden');
    container.querySelector('#stage-panel').classList.remove('hidden');
    container.querySelector('#result-list').innerHTML = '';
    // 初始缩放：让整表宽度尽量适应可视宽度（不放大）
    const totalW = grid.colWidthsPx.reduce((a, b) => a + b, 0);
    const avail = container.querySelector('#stage').clientWidth || 900;
    this.zoom = Math.max(0.3, Math.min(1, (avail - 24) / totalW));
    const zi = container.querySelector('#zoom');
    zi.value = Math.round(this.zoom * 100);
    container.querySelector('#zoom-val').textContent = `${Math.round(this.zoom * 100)}%`;
    this.renderStage(container);
  },

  totalSize() {
    const w = this.grid.colWidthsPx.reduce((a, b) => a + b, 0);
    const h = this.grid.rowHeightsPx.reduce((a, b) => a + b, 0);
    return { w, h };
  },

  applyZoom(container) {
    const inner = container.querySelector('#stage-inner');
    const { w, h } = this.totalSize();
    inner.style.transform = `scale(${this.zoom})`;
    inner.style.width = `${w}px`;
    inner.style.height = `${h}px`;
    // 外层占位随缩放，滚动条正确
    inner.parentElement.style.setProperty('--sw', `${Math.round(w * this.zoom)}px`);
    inner.parentElement.style.setProperty('--sh', `${Math.round(h * this.zoom)}px`);
  },

  renderStage(container) {
    const inner = container.querySelector('#stage-inner');
    inner.innerHTML = '';
    inner.appendChild(this.buildTable());
    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    inner.appendChild(overlay);
    this.applyZoom(container);
    this.renderOverlays(container);
  },

  buildTable() {
    const g = this.grid;
    const table = document.createElement('table');
    table.className = 'grid wysiwyg';
    const colgroup = document.createElement('colgroup');
    for (let c = 0; c < g.columnCount; c++) {
      const col = document.createElement('col');
      col.style.width = `${g.colWidthsPx[c]}px`;
      colgroup.appendChild(col);
    }
    table.appendChild(colgroup);

    for (let r = 1; r <= g.rowCount; r++) {
      const tr = document.createElement('tr');
      tr.style.height = `${g.rowHeightsPx[r - 1]}px`;
      for (let c = 1; c <= g.columnCount; c++) {
        const cellData = g.rows[r - 1][c - 1];
        if (cellData.merge.covered) continue; // 被合并覆盖，跳过
        const td = document.createElement('td');
        if (cellData.merge.rowspan > 1) td.rowSpan = cellData.merge.rowspan;
        if (cellData.merge.colspan > 1) td.colSpan = cellData.merge.colspan;
        td.dataset.row = r;
        td.dataset.col = c;
        td.textContent = cellData.text || '';
        this.applyCellStyle(td, cellData.style);
        if (this.signatures.has(`${r},${c}`)) td.classList.add('signed');
        if (this.selected.has(`${r},${c}`)) td.classList.add('sel-target');
        this.wireCell(td, r, c);
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    return table;
  },

  applyCellStyle(td, s) {
    const f = s.font || {};
    if (f.name) td.style.fontFamily = `"${f.name}", sans-serif`;
    td.style.fontSize = `${Math.round((f.size || 11) * 96 / 72)}px`;
    if (f.bold) td.style.fontWeight = '700';
    if (f.italic) td.style.fontStyle = 'italic';
    if (f.color) td.style.color = f.color;
    if (s.fill) td.style.background = s.fill;
    const alignH = { left: 'left', center: 'center', right: 'right', justify: 'justify' };
    if (s.align && alignH[s.align.h]) td.style.textAlign = alignH[s.align.h];
    const alignV = { top: 'top', middle: 'middle', bottom: 'bottom' };
    td.style.verticalAlign = (s.align && alignV[s.align.v]) || 'middle';
    td.style.whiteSpace = s.align && s.align.wrap ? 'normal' : 'nowrap';
    const b = s.border || {};
    if (b.top) td.style.borderTop = b.top;
    if (b.right) td.style.borderRight = b.right;
    if (b.bottom) td.style.borderBottom = b.bottom;
    if (b.left) td.style.borderLeft = b.left;
  },

  wireCell(td, r, c) {
    const key = `${r},${c}`;
    td.onclick = (e) => {
      if (td.classList.contains('signed') || td.isContentEditable) return;
      e.stopPropagation();
      this.toggleSelect(td, key);
    };
    td.ondblclick = () => {
      if (td.classList.contains('signed')) return this.ctx.toast('该格已有签名，请先右键删除签名再改文字');
      td.contentEditable = 'true';
      td.classList.remove('sel-target');
      this.selected.delete(key);
      td.focus();
    };
    td.onblur = async () => {
      td.contentEditable = 'false';
      const v = td.textContent;
      if (v !== (this.grid.rows[r - 1][c - 1].text || '')) {
        this.grid.rows[r - 1][c - 1].text = v;
        await window.api.xlsx.setCell({ row: r, col: c, value: v });
      }
    };
  },

  toggleSelect(td, key) {
    if (this.selected.has(key)) {
      this.selected.delete(key);
      td.classList.remove('sel-target');
    } else {
      this.selected.add(key);
      td.classList.add('sel-target');
    }
  },

  // ---------- 就地合成 ----------
  async compose(container) {
    if (!this.selected.size) return this.ctx.toast('请先单击选中要合成的单元格');
    const targets = [...this.selected].map((k) => {
      const [row, col] = k.split(',').map(Number);
      return { row, col };
    });
    let items;
    try {
      items = await window.api.xlsx.compose(targets);
    } catch (err) {
      return this.ctx.toast(err.message);
    }
    for (const it of items) {
      this.signatures.set(`${it.row},${it.col}`, it);
      const td = this.tdOf(container, it.row, it.col);
      if (td) { td.classList.add('signed'); td.classList.remove('sel-target'); }
    }
    this.selected.clear();
    this.renderResult(container, items);
    this.renderOverlays(container);
  },

  tdOf(container, row, col) {
    return container.querySelector(`#stage-inner td[data-row="${row}"][data-col="${col}"]`);
  },

  // ---------- 叠加层：原图（只读）+ 签名（可交互）----------
  renderOverlays(container) {
    const overlay = container.querySelector('#overlay');
    if (!overlay) return;
    overlay.innerHTML = '';
    // 原表已有图片：display-only
    for (const im of this.grid.images || []) {
      const el = document.createElement('img');
      el.className = 'existing-img';
      el.src = im.dataUrl;
      Object.assign(el.style, { left: `${im.x}px`, top: `${im.y}px`, width: `${im.w}px`, height: `${im.h}px` });
      overlay.appendChild(el);
    }
    // 签名：可选中/拖拽/缩放/右键
    for (const [key, it] of this.signatures) {
      overlay.appendChild(this.buildSigEl(container, key, it));
    }
  },

  buildSigEl(container, key, it) {
    const box = it.box;
    const wrap = document.createElement('div');
    wrap.dataset.key = key;
    wrap.className = `sig-wrap${this.selectedSig === key ? ' selected' : ''}${it.mode === 'partial' ? ' has-missing' : ''}`;
    Object.assign(wrap.style, {
      left: `${it.region.x + box.offX}px`,
      top: `${it.region.y + box.offY}px`,
      width: `${box.dispW}px`,
      height: `${box.dispH}px`,
    });
    const img = document.createElement('img');
    img.src = it.dataUrl;
    img.draggable = false;
    wrap.appendChild(img);

    // 选中 + 拖动移动
    wrap.onmousedown = (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      this.selectSig(container, key);
      this.startDrag(container, key, e, 'move');
    };
    wrap.onclick = (e) => e.stopPropagation();
    wrap.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.selectSig(container, key);
      this.openMenu(container, key, e.clientX, e.clientY);
    };

    if (this.selectedSig === key) {
      ['nw', 'ne', 'sw', 'se'].forEach((corner) => {
        const h = document.createElement('div');
        h.className = `handle ${corner}`;
        h.onmousedown = (e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          this.startDrag(container, key, e, corner);
        };
        wrap.appendChild(h);
      });
    }
    return wrap;
  },

  selectSig(container, key) {
    this.selectedSig = key;
    this.renderOverlays(container);
  },

  /** 拖动：mode='move' 移动；'nw'/'ne'/'sw'/'se' 拖角自由缩放 */
  startDrag(container, key, e, mode) {
    const it = this.signatures.get(key);
    const region = it.region;
    const start = { ...it.box };
    const sx = e.clientX;
    const sy = e.clientY;
    // selectSig 可能已重建叠加层，按 key 取当前 DOM 元素，避免操作到已分离节点
    const target = container.querySelector(`#overlay .sig-wrap[data-key="${key}"]`);

    const onMove = (ev) => {
      const dx = (ev.clientX - sx) / this.zoom;
      const dy = (ev.clientY - sy) / this.zoom;
      let b = { ...start };
      if (mode === 'move') {
        b.offX = start.offX + dx;
        b.offY = start.offY + dy;
      } else {
        // 拖角自由拉伸（人工允许变形）
        if (mode.includes('e')) b.dispW = start.dispW + dx;
        if (mode.includes('w')) { b.dispW = start.dispW - dx; b.offX = start.offX + dx; }
        if (mode.includes('s')) b.dispH = start.dispH + dy;
        if (mode.includes('n')) { b.dispH = start.dispH - dy; b.offY = start.offY + dy; }
      }
      b = this.clampBox(region, b);
      it.box = b;
      if (target) {
        Object.assign(target.style, {
          left: `${region.x + b.offX}px`, top: `${region.y + b.offY}px`,
          width: `${b.dispW}px`, height: `${b.dispH}px`,
        });
      }
    };
    const onUp = async () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try {
        const fresh = await window.api.xlsx.updateSignature({ row: it.row, col: it.col, box: it.box });
        this.signatures.set(key, fresh);
        this.renderOverlays(container);
      } catch (err) { this.ctx.toast(err.message); }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  },

  clampBox(region, b) {
    const dispW = Math.max(8, Math.min(region.w, b.dispW));
    const dispH = Math.max(8, Math.min(region.h, b.dispH));
    const offX = Math.max(0, Math.min(region.w - dispW, b.offX));
    const offY = Math.max(0, Math.min(region.h - dispH, b.offY));
    return { offX, offY, dispW, dispH };
  },

  // ---------- 右键菜单 ----------
  openMenu(container, key, clientX, clientY) {
    this.closeMenu();
    const it = this.signatures.get(key);
    const menu = document.createElement('div');
    menu.id = 'sig-menu';
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    const item = (label, handler, disabled) =>
      `<div class="menu-item ${disabled ? 'disabled' : ''}" data-k="${label}">${label}</div>`;
    menu.innerHTML =
      item(`换一张字图（${it.variantIndex + 1}/${it.variantCount}）`, null, it.variantCount <= 1) +
      item('重新生成', null, false) +
      '<div class="menu-sep"></div>' +
      '<div class="menu-label">水平</div>' +
      '<div class="menu-align" data-axis="h"><span data-v="left">左</span><span data-v="center">中</span><span data-v="right">右</span></div>' +
      '<div class="menu-label">垂直</div>' +
      '<div class="menu-align" data-axis="v"><span data-v="top">上</span><span data-v="middle">中</span><span data-v="bottom">下</span></div>' +
      '<div class="menu-sep"></div>' +
      item('删除签名', null, false);
    document.body.appendChild(menu);

    const call = async (payload) => {
      this.closeMenu();
      try {
        const fresh = await window.api.xlsx.updateSignature({ row: it.row, col: it.col, ...payload });
        this.signatures.set(key, fresh);
        this.renderOverlays(container);
      } catch (err) { this.ctx.toast(err.message); }
    };
    menu.querySelectorAll('.menu-item').forEach((el) => {
      if (el.classList.contains('disabled')) return;
      el.onclick = (e) => {
        e.stopPropagation();
        const label = el.dataset.k;
        if (label.startsWith('换一张')) call({ action: 'cycleVariant' });
        else if (label === '重新生成') call({ action: 'regenerate' });
        else if (label === '删除签名') this.removeSig(container, key);
      };
    });
    menu.querySelectorAll('.menu-align span').forEach((sp) => {
      sp.onclick = (e) => {
        e.stopPropagation();
        const axis = sp.parentElement.dataset.axis;
        if (axis === 'h') call({ action: 'align', alignH: sp.dataset.v });
        else call({ action: 'align', alignV: sp.dataset.v });
      };
    });
  },

  closeMenu() {
    const m = document.getElementById('sig-menu');
    if (m) m.remove();
  },

  async removeSig(container, key) {
    const it = this.signatures.get(key);
    try {
      await window.api.xlsx.deleteSignature({ row: it.row, col: it.col });
    } catch (err) { return this.ctx.toast(err.message); }
    this.signatures.delete(key);
    if (this.selectedSig === key) this.selectedSig = null;
    const td = this.tdOf(container, it.row, it.col);
    if (td) td.classList.remove('signed'); // 恢复文字可编辑
    this.renderOverlays(container);
    this.ctx.toast(`已删除「${it.word}」的签名，该格恢复可编辑`);
  },

  renderResult(container, items) {
    const listEl = container.querySelector('#result-list');
    const modeText = { word: '整词签名', chars: '单字拼接', partial: '缺字混排' };
    const missItems = items.filter((r) => r.mode === 'partial');
    const esc = window.safeHtml;
    listEl.innerHTML = items.map((r) => {
      if (r.mode === 'partial') {
        return `<div class="miss">✕ ${esc(r.cell)}「${esc(r.word)}」缺字：${esc(r.missing.join('、'))}（系统字体混排，请补录）</div>`;
      }
      return `<div class="ok">✓ ${esc(r.cell)}「${esc(r.word)}」${esc(modeText[r.mode] || '')}</div>`;
    }).join('') || '';
    if (missItems.length) {
      missItems.forEach((r) => {
        const td = [...container.querySelectorAll('#stage-inner td')].find((el) => this.addrOf(el) === r.cell);
        if (td) td.classList.add('missing');
      });
    }
  },

  addrOf(td) {
    const col = Number(td.dataset.col);
    const row = Number(td.dataset.row);
    let letters = '';
    let c = col;
    while (c > 0) { const m = (c - 1) % 26; letters = String.fromCharCode(65 + m) + letters; c = Math.floor((c - 1) / 26); }
    return `${letters}${row}`;
  },

  // ---------- 导出 ----------
  async export(container) {
    let res;
    try {
      res = await window.api.xlsx.export();
    } catch (err) {
      return this.ctx.toast(err.message);
    }
    if (!res) return; // 用户取消
    const listEl = container.querySelector('#result-list');
    listEl.innerHTML = `<p style="color:#188038">已导出：${window.safeHtml(res.outPath)}</p>` + listEl.innerHTML;
    this.ctx.toast('导出完成');
  },
};
