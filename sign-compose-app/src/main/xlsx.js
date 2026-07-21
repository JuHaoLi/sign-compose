'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const ExcelJS = require('exceljs');
const image = require('./image');
const { assertWorksheetBounds, validateXlsxArchive } = require('./file-limits');

const FILL_RATIO = 0.96; // 自动充满比例：仅留约 4% 安全边
const EMU = 9525;        // 1px = 9525 EMU

/** 列宽（Excel 字符单位）→ px；行高（pt）→ px */
function colWidthToPx(width) {
  const w = width || 8.43;
  return Math.round(w * 7) + 5;
}
function rowHeightToPx(height) {
  const h = height || 15;
  return Math.round((h * 96) / 72);
}

/** exceljs 对合并从属单元格取 .text 会抛异常，统一安全读取 */
function cellText(cell) {
  try {
    return (cell.text || '').trim();
  } catch (_) {
    return '';
  }
}

/** exceljs 颜色对象 → CSS #RRGGBB；主题/索引色无法解析时返回 null（继承默认） */
function argbToCss(color) {
  if (!color || !color.argb) return null;
  const a = color.argb;
  if (a.length === 8) return `#${a.slice(2)}`;
  if (a.length === 6) return `#${a}`;
  return null;
}

/** exceljs 边框对象 → CSS border 简写；无边框返回 null */
function cssBorder(b) {
  if (!b || !b.style) return null;
  const map = {
    thin: '1px solid', medium: '2px solid', thick: '3px solid', hair: '1px solid',
    dotted: '1px dotted', dashed: '1px dashed', double: '3px double',
    mediumDashed: '2px dashed', dashDot: '1px dashed', mediumDashDot: '2px dashed',
    slantDashDot: '1px dashed', dashDotDot: '1px dashed',
  };
  const s = map[b.style] || '1px solid';
  const col = argbToCss(b.color) || '#c9cdd4';
  return `${s} ${col}`;
}

/** 单元格样式 → 前端可直接用的内联样式描述 */
function cellStyle(cell) {
  const f = cell.font || {};
  const fillC = (cell.fill && cell.fill.type === 'pattern' && cell.fill.pattern === 'solid')
    ? argbToCss(cell.fill.fgColor) : null;
  const al = cell.alignment || {};
  const b = cell.border || {};
  return {
    font: {
      name: f.name || null,
      size: f.size || null,
      bold: !!f.bold,
      italic: !!f.italic,
      color: argbToCss(f.color),
    },
    fill: fillC,
    align: { h: al.horizontal || null, v: al.vertical || null, wrap: !!al.wrapText },
    border: {
      top: cssBorder(b.top), right: cssBorder(b.right),
      bottom: cssBorder(b.bottom), left: cssBorder(b.left),
    },
  };
}

/** 解析 "B3:D5" 合并串 → {top,left,bottom,right}（1-based 行列） */
function parseMerge(ref) {
  const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) return null;
  const colOf = (letters) => {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  };
  return { left: colOf(m[1]), top: Number(m[2]), right: colOf(m[3]), bottom: Number(m[4]) };
}

/**
 * 为一个词合成签名图：整词优先，否则逐字拼接（缺字用系统字体）
 * @returns {Promise<{png:Buffer, mode:string, missing:string[], width:number, height:number}>}
 */
async function composeForWord(word, library, variantIndex = 0) {
  const wordPath = library.getWordImage(word, variantIndex);
  if (wordPath) {
    const { png } = await image.trimWhite(await sharp(wordPath).png().toBuffer());
    const meta = await sharp(png).metadata();
    return { png, mode: 'word', missing: [], width: meta.width, height: meta.height };
  }
  const tiles = [];
  const missing = [];
  for (const ch of word) {
    const charPath = library.getCharImage(ch, variantIndex);
    if (charPath) {
      tiles.push(await fs.promises.readFile(charPath));
    } else {
      missing.push(ch);
      tiles.push(await image.renderTextChar(ch));
    }
  }
  const composed = await image.composeWord(tiles);
  const meta = await sharp(composed.png).metadata();
  return {
    png: composed.png,
    mode: missing.length ? 'partial' : 'chars',
    missing,
    width: meta.width,
    height: meta.height,
  };
}

/**
 * 一个已打开的 xlsx 文档：富样式网格、单元格编辑、就地签名（compose/update/delete）与导出
 */
class XlsxDoc {
  constructor() {
    this.workbook = null;
    this.filePath = null;
    this.items = new Map(); // key "r,c" → 已放签名项
    this.colWidthsPx = [];  // 0-based：col1..colN 的像素宽
    this.rowHeightsPx = [];
    this.cumX = [];         // 0-based 列左边缘累进（长度 N+1）
    this.cumY = [];
  }

  async open(filePath) {
    await validateXlsxArchive(filePath);
    this.workbook = new ExcelJS.Workbook();
    await this.workbook.xlsx.readFile(filePath);
    const firstSheet = this.workbook.worksheets[0];
    if (!firstSheet) throw new Error('表格中没有工作表');
    assertWorksheetBounds(firstSheet.rowCount, firstSheet.columnCount);
    this.filePath = filePath;
    this.items = new Map();
    this._computeGeometry();
    return this.grid();
  }

  get ws() {
    return this.workbook.worksheets[0];
  }

  /** 计算列宽/行高像素与累进边缘（excel-px 坐标系） */
  _computeGeometry() {
    const ws = this.ws;
    this.colWidthsPx = [];
    this.cumX = [0];
    for (let c = 1; c <= ws.columnCount; c++) {
      const px = colWidthToPx(ws.getColumn(c).width);
      this.colWidthsPx.push(px);
      this.cumX.push(this.cumX[this.cumX.length - 1] + px);
    }
    this.rowHeightsPx = [];
    this.cumY = [0];
    for (let r = 1; r <= ws.rowCount; r++) {
      const px = rowHeightToPx(ws.getRow(r).height);
      this.rowHeightsPx.push(px);
      this.cumY.push(this.cumY[this.cumY.length - 1] + px);
    }
  }

  /** 分数 0-based 列坐标 → px（原表已有图片锚点换算用） */
  _colEdgePx(colFloat0) {
    const i = Math.max(0, Math.min(this.colWidthsPx.length - 1, Math.floor(colFloat0)));
    const base = this.cumX[i] != null ? this.cumX[i] : 0;
    return base + (colFloat0 - i) * (this.colWidthsPx[i] || 0);
  }

  _rowEdgePx(rowFloat0) {
    const i = Math.max(0, Math.min(this.rowHeightsPx.length - 1, Math.floor(rowFloat0)));
    const base = this.cumY[i] != null ? this.cumY[i] : 0;
    return base + (rowFloat0 - i) * (this.rowHeightsPx[i] || 0);
  }

  /** 绝对 x(px) → {index0, offPx}（导出锚点用） */
  _walkX(px) {
    let i = 0;
    while (i < this.colWidthsPx.length - 1 && this.cumX[i + 1] <= px) i++;
    return { index0: i, offPx: px - this.cumX[i] };
  }

  _walkY(px) {
    let i = 0;
    while (i < this.rowHeightsPx.length - 1 && this.cumY[i + 1] <= px) i++;
    return { index0: i, offPx: px - this.cumY[i] };
  }

  /** 单元格所在区域（合并区则取整个合并区）：1-based 行列 */
  _region(row, col) {
    for (const ref of this.ws.model.merges || []) {
      const m = parseMerge(ref);
      if (m && row >= m.top && row <= m.bottom && col >= m.left && col <= m.right) return m;
    }
    return { top: row, left: col, bottom: row, right: col };
  }

  /** 区域在 excel-px 的矩形 {x,y,w,h} */
  _regionRect(row, col) {
    const m = this._region(row, col);
    const x = this.cumX[m.left - 1];
    const y = this.cumY[m.top - 1];
    const w = this.cumX[m.right] - this.cumX[m.left - 1];
    const h = this.cumY[m.bottom] - this.cumY[m.top - 1];
    return { x, y, w, h };
  }

  /** 自动放置：宽高比锁定、等比充满区域（留安全边）、居中 → box（相对区域左上角） */
  _autoBox(region, imgW, imgH) {
    const fit = Math.min((region.w * FILL_RATIO) / imgW, (region.h * FILL_RATIO) / imgH);
    const dispW = imgW * fit;
    const dispH = imgH * fit;
    return {
      offX: (region.w - dispW) / 2,
      offY: (region.h - dispH) / 2,
      dispW,
      dispH,
    };
  }

  /** 把 box 钳制在区域内（手动拖拽/对齐后保证不越界） */
  _clampBox(region, box) {
    const dispW = Math.max(4, Math.min(region.w, box.dispW));
    const dispH = Math.max(4, Math.min(region.h, box.dispH));
    const offX = Math.max(0, Math.min(region.w - dispW, box.offX));
    const offY = Math.max(0, Math.min(region.h - dispH, box.offY));
    return { offX, offY, dispW, dispH };
  }

  /** 提取富网格：文本 + 每格样式 + 合并跨度 + 列宽行高 + 原有图片 */
  grid() {
    const ws = this.ws;
    // 合并跨度与覆盖标记
    const mergeMap = {}; // "r,c" → {anchor, covered, rowspan, colspan}
    for (const ref of ws.model.merges || []) {
      const m = parseMerge(ref);
      if (!m) continue;
      for (let r = m.top; r <= m.bottom; r++) {
        for (let c = m.left; c <= m.right; c++) {
          mergeMap[`${r},${c}`] = (r === m.top && c === m.left)
            ? { anchor: true, covered: false, rowspan: m.bottom - m.top + 1, colspan: m.right - m.left + 1 }
            : { anchor: false, covered: true, rowspan: 1, colspan: 1 };
        }
      }
    }
    const rows = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = [];
      const excelRow = ws.getRow(r);
      for (let c = 1; c <= ws.columnCount; c++) {
        const cell = excelRow.getCell(c);
        row.push({
          text: cellText(cell),
          style: cellStyle(cell),
          merge: mergeMap[`${r},${c}`] || { anchor: false, covered: false, rowspan: 1, colspan: 1 },
        });
      }
      rows.push(row);
    }
    return {
      filePath: this.filePath,
      sheetName: ws.name,
      rowCount: ws.rowCount,
      columnCount: ws.columnCount,
      colWidthsPx: this.colWidthsPx,
      rowHeightsPx: this.rowHeightsPx,
      rows,
      merges: ws.model.merges || [],
      images: this._existingImages(),
    };
  }

  /** 原表已有嵌入图片 → excel-px 定位 + dataUrl（display-only 还原） */
  _existingImages() {
    const ws = this.ws;
    const out = [];
    let list = [];
    try { list = ws.getImages() || []; } catch (_) { list = []; }
    for (const im of list) {
      const media = this.workbook.getImage(im.imageId);
      if (!media || !media.buffer) continue;
      const r = im.range || {};
      const tl = r.tl;
      if (!tl) continue;
      const x = this._colEdgePx(tl.col);
      const y = this._rowEdgePx(tl.row);
      let w;
      let h;
      if (r.br) {
        w = this._colEdgePx(r.br.col) - x;
        h = this._rowEdgePx(r.br.row) - y;
      } else if (r.ext) {
        w = r.ext.width / EMU;
        h = r.ext.height / EMU;
      } else {
        continue;
      }
      out.push({
        x, y, w, h,
        dataUrl: `data:image/${media.extension || 'png'};base64,${media.buffer.toString('base64')}`,
      });
    }
    return out;
  }

  setCell(row, col, value) {
    this.ws.getCell(row, col).value = value;
  }

  /** 组装发给渲染进程的展示项 */
  _decorate(item, library) {
    const region = this._regionRect(item.row, item.col);
    let variantCount;
    if (item.mode === 'word') {
      variantCount = library.variantCount('word', item.word);
    } else {
      variantCount = Math.max(1, ...[...item.word].map((ch) => library.variantCount('char', ch)));
    }
    return {
      row: item.row,
      col: item.col,
      cell: this.ws.getCell(item.row, item.col).address,
      word: item.word,
      mode: item.mode,
      missing: item.missing,
      variantIndex: item.variantIndex,
      variantCount,
      region,
      box: item.box,
      imgW: item.imgW,
      imgH: item.imgH,
      dataUrl: image.toDataUrl(item.png),
    };
  }

  /** 合成一批目标单元格的签名，存入 this.items，返回展示项列表（不写文件） */
  async compose(targets, library) {
    const out = [];
    for (const { row, col } of targets) {
      const word = cellText(this.ws.getCell(row, col));
      if (!word) continue;
      const composed = await composeForWord(word, library, 0);
      const region = this._regionRect(row, col);
      const item = {
        row,
        col,
        word,
        mode: composed.mode,
        missing: composed.missing,
        variantIndex: 0,
        png: composed.png,
        imgW: composed.width,
        imgH: composed.height,
        box: this._autoBox(region, composed.width, composed.height),
      };
      this.items.set(`${row},${col}`, item);
      out.push(this._decorate(item, library));
    }
    return out;
  }

  /**
   * 调整一张已放签名：
   * - box：手动缩放/移动覆盖（允许自由拉伸，钳制在区域内）
   * - action 'cycleVariant' | 'regenerate'：换图/重生成 → 重算 png + 自动 box（宽高比锁定）
   * - action 'align'：按 alignH/alignV 在区域内重排，保持当前尺寸
   */
  async updateSignature({ row, col, box, action, alignH, alignV }, library) {
    const key = `${row},${col}`;
    const item = this.items.get(key);
    if (!item) throw new Error('该签名已失效，请重新合成');
    const region = this._regionRect(row, col);

    if (action === 'cycleVariant' || action === 'regenerate') {
      if (action === 'cycleVariant') {
        const count = this._decorate(item, library).variantCount;
        item.variantIndex = (item.variantIndex + 1) % Math.max(1, count);
      }
      const composed = await composeForWord(item.word, library, item.variantIndex);
      item.png = composed.png;
      item.mode = composed.mode;
      item.missing = composed.missing;
      item.imgW = composed.width;
      item.imgH = composed.height;
      item.box = this._autoBox(region, composed.width, composed.height); // 重生成回到不变形自动放置
    } else if (action === 'align') {
      const b = { ...item.box };
      if (alignH === 'left') b.offX = region.w * 0.02;
      else if (alignH === 'right') b.offX = region.w - b.dispW - region.w * 0.02;
      else if (alignH === 'center') b.offX = (region.w - b.dispW) / 2;
      if (alignV === 'top') b.offY = region.h * 0.02;
      else if (alignV === 'bottom') b.offY = region.h - b.dispH - region.h * 0.02;
      else if (alignV === 'middle') b.offY = (region.h - b.dispH) / 2;
      item.box = this._clampBox(region, b);
    } else if (box) {
      item.box = this._clampBox(region, box);
    }
    return this._decorate(item, library);
  }

  deleteSignature(row, col) {
    this.items.delete(`${row},${col}`);
  }

  hasItems() {
    return this.items.size > 0;
  }

  /**
   * 导出：清空已签名格文字 + 图片悬浮锚定（twoCellAnchor），另存新文件（红线 3）
   * 原表已有图片由 exceljs 在写回时保留。
   */
  async writeItems(outPath) {
    const workbook = new ExcelJS.Workbook();
    const snapshot = await this.workbook.xlsx.writeBuffer();
    await workbook.xlsx.load(snapshot);
    const ws = workbook.worksheets[0];
    for (const item of this.items.values()) {
      ws.getCell(item.row, item.col).value = null;
      const region = this._regionRect(item.row, item.col);
      const xTl = region.x + item.box.offX;
      const yTl = region.y + item.box.offY;
      const xBr = xTl + item.box.dispW;
      const yBr = yTl + item.box.dispH;
      const tlC = this._walkX(xTl);
      const tlR = this._walkY(yTl);
      const brC = this._walkX(xBr);
      const brR = this._walkY(yBr);
      const imageId = workbook.addImage({ buffer: item.png, extension: 'png' });
      ws.addImage(imageId, {
        tl: {
          nativeCol: tlC.index0,
          nativeColOff: Math.round(tlC.offPx * EMU),
          nativeRow: tlR.index0,
          nativeRowOff: Math.round(tlR.offPx * EMU),
        },
        br: {
          nativeCol: brC.index0,
          nativeColOff: Math.round(brC.offPx * EMU),
          nativeRow: brR.index0,
          nativeRowOff: Math.round(brR.offPx * EMU),
        },
        editAs: 'oneCell',
      });
    }
    await workbook.xlsx.writeFile(outPath);
  }

  /** 导出结果摘要（缺字清单） */
  results() {
    return [...this.items.values()].map((it) => ({
      cell: this.ws.getCell(it.row, it.col).address,
      word: it.word,
      mode: it.mode,
      missing: it.missing,
    }));
  }
}

/** 默认输出路径：原名_已合成.xlsx */
function defaultOutPath(srcPath) {
  const dir = path.dirname(srcPath);
  const ext = path.extname(srcPath);
  const base = path.basename(srcPath, ext);
  return path.join(dir, `${base}_已合成${ext}`);
}

module.exports = { XlsxDoc, defaultOutPath, composeForWord, FILL_RATIO };
