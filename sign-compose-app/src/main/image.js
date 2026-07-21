'use strict';

const sharp = require('sharp');

const TARGET_HEIGHT = 200; // 合成时单字统一高度（px）
const OVERLAP_RATIO = 0.10; // 相邻字重叠比例
const BIN_THRESHOLD = 180; // 二值化阈值（灰度低于此值为黑）
const DILATE_PASSES = 1; // 笔画加粗次数（3x3 膨胀）

/** 读图并转为灰度 raw 像素 */
async function toGrayRaw(input) {
  const { data, info } = await sharp(input)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** 二值灰度数组 → 白底黑字 PNG Buffer */
async function bwToPng(bw, width, height) {
  // bw: Uint8Array，0=黑，255=白
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < bw.length; i++) {
    const v = bw[i];
    rgb[i * 3] = v; rgb[i * 3 + 1] = v; rgb[i * 3 + 2] = v;
  }
  return sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** 3x3 膨胀（黑向白扩张），加粗笔画 */
function dilate(bw, width, height) {
  const out = new Uint8Array(bw);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (
        bw[i] === 0 || bw[i - 1] === 0 || bw[i + 1] === 0 ||
        bw[i - width] === 0 || bw[i + width] === 0
      ) {
        out[i] = 0;
      }
    }
  }
  return out;
}

/**
 * 任意照片 → 纯白底 + 纯黑字 PNG（红线 7）
 * 灰度 → 阈值二值化 → 膨胀加粗
 */
async function binarize(input, { threshold = BIN_THRESHOLD, dilatePasses = DILATE_PASSES } = {}) {
  const { data, width, height } = await toGrayRaw(input);
  let bw = new Uint8Array(width * height);
  for (let i = 0; i < bw.length; i++) bw[i] = data[i] < threshold ? 0 : 255;
  for (let p = 0; p < dilatePasses; p++) bw = dilate(bw, width, height);
  return bwToPng(bw, width, height);
}

/** 按墨迹裁掉四周白边，返回 {png, width, height} */
async function trimWhite(input) {
  const { data, width, height } = await toGrayRaw(input);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] < 250) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('框选区域内没有有效墨迹');
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const png = await sharp(input)
    .extract({ left: minX, top: minY, width: w, height: h })
    .png()
    .toBuffer();
  return { png, width: w, height: h };
}

/**
 * 画框框选：裁出指定矩形区域 → 二值化 → 修白边
 * @param {Buffer} input 原照片
 * @param {{left:number,top:number,width:number,height:number}} rect 框选矩形（原图坐标）
 */
async function cropRegion(input, rect) {
  const meta = await sharp(input).metadata();
  const left = Math.max(0, Math.round(rect.left));
  const top = Math.max(0, Math.round(rect.top));
  const width = Math.min(Math.round(rect.width), meta.width - left);
  const height = Math.min(Math.round(rect.height), meta.height - top);
  if (width < 2 || height < 2) throw new Error('框选区域过小');
  const region = await sharp(input).extract({ left, top, width, height }).png().toBuffer();
  const bin = await binarize(region);
  const trimmed = await trimWhite(bin);
  return trimmed.png;
}

/** 整词图：二值化 + 修白边 */
async function wordImage(input) {
  const bin = await binarize(input);
  const trimmed = await trimWhite(bin);
  return trimmed.png;
}

/** 用系统字体把缺字渲染成白底黑字 PNG（缺字混排用） */
async function renderTextChar(ch, height = TARGET_HEIGHT) {
  const fontSize = Math.round(height * 0.82);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${height}" height="${height}">
  <rect width="100%" height="100%" fill="white"/>
  <text x="50%" y="52%" dominant-baseline="central" text-anchor="middle"
    font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif"
    font-size="${fontSize}" fill="black">${ch}</text>
</svg>`;
  const { png } = await trimWhite(await sharp(Buffer.from(svg)).png().toBuffer());
  return png;
}

/** 给白底图补一圈白边，避免拼接重叠时边缘笔画被切断 */
async function padWhite(input, pad) {
  return sharp(input).extend({
    top: pad, bottom: pad, left: pad, right: pad,
    background: { r: 255, g: 255, b: 255 },
  }).png().toBuffer();
}

/**
 * 单字拼接：统一字高、横向排列、相邻字重叠 10%，白底用 multiply 融合（重叠处取更黑者）
 * @param {Buffer[]} charPngs 白底黑字单字 PNG（缺字已由 renderTextChar 生成）
 * @returns {Promise<{png: Buffer, width: number, height: number}>}
 */
async function composeWord(charPngs) {
  if (!charPngs.length) throw new Error('没有可合成的字');
  // 1) 修白边 + 等比缩放到统一高度
  const tiles = [];
  for (const buf of charPngs) {
    const { png } = await trimWhite(buf);
    const meta = await sharp(png).metadata();
    const w = Math.max(1, Math.round((meta.width / meta.height) * TARGET_HEIGHT));
    const resized = await sharp(png).resize({ width: w, height: TARGET_HEIGHT }).png().toBuffer();
    tiles.push({ png: resized, width: w });
  }
  // 2) 计算重叠与排布
  const overlaps = tiles.map((t, i) => (i < tiles.length - 1 ? Math.round(t.width * OVERLAP_RATIO) : 0));
  const xs = [0];
  for (let i = 1; i < tiles.length; i++) {
    xs.push(xs[i - 1] + tiles[i - 1].width - overlaps[i - 1]);
  }
  const totalW = xs[xs.length - 1] + tiles[tiles.length - 1].width;
  // 3) 白画布上 multiply 合成
  const composites = tiles.map((t, i) => ({
    input: t.png, left: xs[i], top: 0, blend: 'multiply',
  }));
  const png = await sharp({
    create: { width: totalW, height: TARGET_HEIGHT, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).composite(composites).png().toBuffer();
  return { png, width: totalW, height: TARGET_HEIGHT };
}

/** PNG Buffer → data URL（渲染进程预览用） */
function toDataUrl(png) {
  return `data:image/png;base64,${png.toString('base64')}`;
}

module.exports = {
  TARGET_HEIGHT,
  binarize,
  trimWhite,
  padWhite,
  cropRegion,
  wordImage,
  renderTextChar,
  composeWord,
  toDataUrl,
};
