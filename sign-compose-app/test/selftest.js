'use strict';
// 自测脚本（非 app 一部分）：node test/selftest.js [样例xlsx路径]
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');
const ExcelJS = require('exceljs');
const { UserStore } = require('../src/main/users');
const { LibraryStore } = require('../src/main/library');
const image = require('../src/main/image');
const { XlsxDoc, defaultOutPath } = require('../src/main/xlsx');
const { SessionGuard } = require('../src/main/session-guard');
const {
  MAX_IMAGE_BYTES,
  MAX_XLSX_ENTRIES,
  MAX_XLSX_UNCOMPRESSED_BYTES,
  assertFileSize,
  assertArchiveShape,
  assertWorksheetBounds,
  validateXlsxArchive,
} = require('../src/main/file-limits');

const savedWindow = global.window;
global.window = {};
require('../src/renderer/safe');
const safeHtml = global.window.safeHtml;
if (savedWindow === undefined) delete global.window;
else global.window = savedWindow;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-test-'));
let failures = 0;
const ok = (name, cond) => {
  if (!cond) failures += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
};

async function createSyntheticWorkbook(filePath, imageBuffer) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Synthetic Test Fixture';
  workbook.lastModifiedBy = 'Synthetic Test Fixture';
  workbook.created = new Date('2026-01-01T00:00:00.000Z');
  workbook.modified = new Date('2026-01-01T00:00:00.000Z');
  const ws = workbook.addWorksheet('示例记录');
  ws.columns = [{ width: 18 }, { width: 18 }, { width: 16 }, { width: 16 }];
  ws.getRow(1).height = 28;
  ws.getRow(4).height = 36;
  ws.mergeCells('A1:D2');
  ws.getCell('A1').value = '示例巡查记录表';
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell('A1').font = { bold: true, size: 16 };
  ws.getCell('A3').value = '签名';
  ws.getCell('B3').value = '日期';
  ws.getCell('C3').value = '状态';
  ws.getCell('D3').value = '备注';
  ws.getCell('B4').value = '2026-01-01';
  ws.getCell('C4').value = '示例';
  ws.getCell('D4').value = '仅用于自动化测试';
  ['A3', 'B3', 'C3', 'D3'].forEach((address) => {
    ws.getCell(address).font = { bold: true };
    ws.getCell(address).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F8' } };
  });
  const imageId = workbook.addImage({ buffer: imageBuffer, extension: 'png' });
  ws.addImage(imageId, { tl: { col: 3.15, row: 2.15 }, ext: { width: 56, height: 34 } });
  await workbook.xlsx.writeFile(filePath);
}

(async () => {
  ok('HTML 动态文本转义', safeHtml(`<img src=x onerror="bad()">'&`) === '&lt;img src=x onerror=&quot;bad()&quot;&gt;&#39;&amp;');

  // ---------- 安全边界：会话失效、待确认导入和资源上限 ----------
  const guard = new SessionGuard();
  guard.enter('user-a');
  const tokenA = guard.capture();
  ok('当前用户会话令牌有效', (() => { try { guard.assert(tokenA); return true; } catch (_) { return false; } })());
  guard.approveImport(tokenA, { filePath: '/tmp/fixture.png', word: '甲' });
  ok('待确认图片仅能由匹配词语消费', guard.consumeImport(tokenA, '甲').filePath === '/tmp/fixture.png');
  ok('待确认图片不能重放', (() => { try { guard.consumeImport(tokenA, '甲'); return false; } catch (_) { return true; } })());
  guard.approveImport(tokenA, { filePath: '/tmp/fixture.png', word: '甲' });
  ok('词语不匹配时拒绝确认', (() => { try { guard.consumeImport(tokenA, '乙'); return false; } catch (_) { return true; } })());
  guard.enter('user-b');
  ok('切换账号后旧会话失效', (() => { try { guard.assert(tokenA); return false; } catch (_) { return true; } })());

  const tinyFile = path.join(tmp, 'tiny.bin');
  fs.writeFileSync(tinyFile, 'ok');
  ok('普通大小文件通过限制', assertFileSize(tinyFile, MAX_IMAGE_BYTES, '测试文件') === 2);
  const oversizedFile = path.join(tmp, 'oversized.bin');
  fs.writeFileSync(oversizedFile, '');
  fs.truncateSync(oversizedFile, MAX_IMAGE_BYTES + 1);
  ok('超大文件在读取前被拒绝', (() => { try { assertFileSize(oversizedFile, MAX_IMAGE_BYTES, '测试文件'); return false; } catch (_) { return true; } })());
  const invalidXlsx = path.join(tmp, 'invalid.xlsx');
  fs.writeFileSync(invalidXlsx, 'not-a-zip');
  let invalidZipRejected = false;
  try { await validateXlsxArchive(invalidXlsx); } catch (_) { invalidZipRejected = true; }
  ok('无效 xlsx 压缩包被拒绝', invalidZipRejected);
  ok('过多压缩包条目被拒绝', (() => { try { assertArchiveShape(Array(MAX_XLSX_ENTRIES + 1).fill({})); return false; } catch (_) { return true; } })());
  ok('解压体积过大的压缩包被拒绝', (() => { try { assertArchiveShape([{ _data: { uncompressedSize: MAX_XLSX_UNCOMPRESSED_BYTES + 1 } }]); return false; } catch (_) { return true; } })());
  ok('常规工作表范围通过限制', (() => { try { assertWorksheetBounds(100, 20); return true; } catch (_) { return false; } })());
  ok('超行数工作表被拒绝', (() => { try { assertWorksheetBounds(10_001, 1); return false; } catch (_) { return true; } })());
  ok('超列数工作表被拒绝', (() => { try { assertWorksheetBounds(1, 257); return false; } catch (_) { return true; } })());
  ok('超总格数工作表被拒绝', (() => { try { assertWorksheetBounds(1_000, 201); return false; } catch (_) { return true; } })());

  // ---------- 1. 用户（账号+密码登录）与签名库 ----------
  const users = new UserStore(tmp);
  const u1 = users.create({ account: 'user_alpha', name: '测试用户甲', password: 'test-pass-1' });
  const u2 = users.create({ account: 'user_beta', name: '测试用户乙', password: 'test-pass-2' });
  ok('创建两个账号', users.list().length === 2);
  ok('用户目录隔离', users.userDir(u1.id) !== users.userDir(u2.id));
  ok('profile 不含明文密码', !('password' in u1) && !('passwordHash' in u1));
  ok('正确密码可登录', users.login('user_alpha', 'test-pass-1').id === u1.id);
  ok('账号大小写不敏感', users.login('USER_ALPHA', 'test-pass-1').id === u1.id);
  let loginErr = null;
  try { users.login('user_alpha', 'wrong'); } catch (e) { loginErr = e.message; }
  ok('错误密码被拒', !!loginErr);
  ok('重复账号被拒', (() => { try { users.create({ account: 'user_alpha', name: '测试', password: 'y' }); return false; } catch (_) { return true; } })());
  ok('过短密码被拒', (() => { try { users.create({ account: 'short_pw', password: '1234567' }); return false; } catch (_) { return true; } })());
  ok('过长密码被拒', (() => { try { users.create({ account: 'long_pw', password: 'x'.repeat(129) }); return false; } catch (_) { return true; } })());
  ok('不隐式创建固定默认账号', users.findByAccount('admin') === null && users.list().length === 2);

  // ---------- 2. 图像：合成白底黑字"签名"照片 ----------
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">
  <rect width="100%" height="100%" fill="white"/>
  <g fill="none" stroke="#555" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
    <path d="M25 45 C55 25 105 30 125 55 M35 90 C70 72 105 78 130 105 M45 135 C75 115 110 120 125 145"/>
    <path d="M170 50 C205 25 255 35 285 65 M175 105 C210 82 260 90 290 122 M190 145 C220 125 255 128 275 150"/>
    <path d="M330 55 C365 25 420 30 455 65 M340 105 C380 75 430 85 465 120 M355 150 C395 118 440 125 465 150"/>
  </g>
</svg>`;
  const rawPhoto = await sharp(Buffer.from(svg)).png().toBuffer();

  // 二值化 + 加粗
  const bin = await image.binarize(rawPhoto);
  const g = await sharp(bin).grayscale().raw().toBuffer({ resolveWithObject: true });
  const corner = g.data[0];
  ok('二值化后白底为纯白(255)', corner === 255);
  const inkCount = (buf) => buf.reduce((n, v) => n + (v === 0 ? 1 : 0), 0);
  const gRaw = await sharp(rawPhoto).grayscale().raw().toBuffer({ resolveWithObject: true });
  const origInk = gRaw.data.reduce((n, v) => n + (v < 128 ? 1 : 0), 0);
  const binInk = inkCount(g.data);
  ok('笔画已加粗（墨迹像素增多）', binInk > origInk);

  // ---------- 3. 画框裁剪入库 ----------
  const boxes = [
    { left: 10, top: 20, width: 130, height: 150 },
    { left: 150, top: 20, width: 150, height: 150 },
    { left: 310, top: 20, width: 160, height: 150 },
  ];
  const charPngs = [];
  for (const b of boxes) charPngs.push(await image.cropRegion(rawPhoto, b));
  ok('逐字画框裁出 3 张单字图', charPngs.length === 3);
  const wordPng = await image.cropRegion(rawPhoto, { left: 10, top: 20, width: 460, height: 150 });
  // 白底校验：单字图四角为白
  const cg = await sharp(charPngs[0]).grayscale().raw().toBuffer({ resolveWithObject: true });
  ok('单字图白底', cg.data[0] === 255 && cg.data[cg.data.length - 1] === 255);

  const lib = new LibraryStore(users.userDir(u1.id));
  lib.addSignature('甲乙丙', wordPng, [
    { char: '甲', png: charPngs[0] },
    { char: '乙', png: charPngs[1] },
    { char: '丙', png: charPngs[2] },
  ]);
  ok('整词默认图可查', !!lib.getWordImage('甲乙丙'));
  ok('单字默认图可查', !!lib.getCharImage('甲'));
  ok('用户2库隔离查不到', new LibraryStore(users.userDir(u2.id)).getCharImage('甲') === null);

  // 备份迁移（红线 5）
  const bakDir = path.join(tmp, 'backup-user');
  fs.cpSync(users.userDir(u1.id), bakDir, { recursive: true });
  ok('目录拷贝后库可读', !!new LibraryStore(bakDir).getWordImage('甲乙丙'));

  // ---------- 4. 字体库列表 / 设默认 / 删除 / 补单字 ----------
  const list = lib.listChars();
  ok('单字列表 3 组且每组有默认图', list.length === 3 && list.every((x) => x.entries.filter((e) => e.isDefault).length === 1));
  // 再录一次同名签名 → 甲 有 2 张
  lib.addSignature('甲乙丙', wordPng, [
    { char: '甲', png: charPngs[0] },
    { char: '乙', png: charPngs[1] },
    { char: '丙', png: charPngs[2] },
  ]);
  ok('同字多图：甲=2 张', lib.variantCount('char', '甲') === 2);
  const entries = lib.listChars().find((x) => x.char === '甲').entries;
  const second = entries.find((e) => !e.isDefault);
  lib.setDefault('char', '甲', second.id);
  ok('设默认生效', lib.listChars().find((x) => x.char === '甲').entries.find((e) => e.id === second.id).isDefault);
  lib.deleteEntry('char', '甲', second.id);
  ok('删除后默认自动提升', lib.variantCount('char', '甲') === 1 && !!lib.getCharImage('甲'));
  lib.addCharImage('丁', await image.renderTextChar('丁'));
  ok('补单字入库', !!lib.getCharImage('丁'));
  ok('词列表 1 组', lib.listWords().length === 1 && lib.listWords()[0].word === '甲乙丙');
  ok('readEntry 可读缩略图', !!lib.readEntry('char', '甲', lib.listChars()[0].entries[0].id));

  // 路径隔离回归：词语即使含 ../，也不能影响其他账号目录。
  const victimFile = path.join(users.userDir(u2.id), 'words', 'target.png');
  fs.writeFileSync(victimFile, 'ORIGINAL');
  const craftedWord = `../../${u2.id}/words/target`;
  lib.addSignature(craftedWord, wordPng, [...craftedWord].map((char) => ({ char, png: charPngs[0] })));
  const allFiles = [
    ...lib.listWords().flatMap((group) => group.entries.map((entry) => entry.file)),
    ...lib.listChars().flatMap((group) => group.entries.map((entry) => entry.file)),
  ];
  const root = path.resolve(users.userDir(u1.id));
  ok('恶意词语不能跨账号覆盖文件', fs.readFileSync(victimFile, 'utf8') === 'ORIGINAL');
  ok('所有签名资源路径均限制在当前账号目录', allFiles.every((file) => {
    const relative = path.relative(root, path.resolve(root, file));
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  }));
  ok('资源文件名不包含用户输入文字', allFiles.every((file) => !file.includes('甲乙丙') && !file.includes('target')));
  lib.index.words.legacy_path = [{
    id: 'legacy_path', file: `../../${u2.id}/words/target.png`, isDefault: true,
  }];
  let legacyReadBlocked = false;
  let legacyDeleteBlocked = false;
  try { lib.readEntry('word', 'legacy_path', 'legacy_path'); } catch (_) { legacyReadBlocked = true; }
  try { lib.deleteEntry('word', 'legacy_path', 'legacy_path'); } catch (_) { legacyDeleteBlocked = true; }
  ok('旧索引中的越界读取路径被拒绝', legacyReadBlocked);
  ok('旧索引中的越界删除路径被拒绝', legacyDeleteBlocked && fs.readFileSync(victimFile, 'utf8') === 'ORIGINAL');
  delete lib.index.words.legacy_path;

  // ---------- 5. 拼接（白底 multiply） ----------
  const composed = await image.composeWord([charPngs[0], charPngs[1], charPngs[2]]);
  const cg2 = await sharp(composed.png).grayscale().raw().toBuffer({ resolveWithObject: true });
  ok('拼接图白底且尺寸合理', cg2.data[0] === 255 && composed.width > 200 && composed.height === image.TARGET_HEIGHT);
  fs.writeFileSync(path.join(tmp, 'composed.png'), composed.png);
  const withMissing = await image.composeWord([charPngs[0], await image.renderTextChar('丁')]);
  ok('缺字混排合成成功', withMissing.width > 0);

  // ---------- 6. xlsx：富网格 + 就地合成 + 调整 + 导出 ----------
  let sample = process.argv[2];
  if (!sample) {
    sample = path.join(tmp, 'synthetic-sample.xlsx');
    await createSyntheticWorkbook(sample, rawPhoto);
    console.log('（使用临时目录中的全合成 xlsx 测试样例）');
  }
  if (fs.existsSync(sample)) {
    const md5 = (p) => require('crypto').createHash('md5').update(fs.readFileSync(p)).digest('hex');
    const hashBefore = md5(sample);
    const doc = new XlsxDoc();
    const gr = await doc.open(sample);

    // 富网格提取（最大还原）
    ok('富网格：返回列宽/行高数组', Array.isArray(gr.colWidthsPx) && gr.colWidthsPx.length === gr.columnCount
      && gr.rowHeightsPx.length === gr.rowCount);
    ok('富网格：单元格含样式对象', gr.rows[0][0] && typeof gr.rows[0][0].style === 'object'
      && 'font' in gr.rows[0][0].style && 'border' in gr.rows[0][0].style);
    const hasMergeAnchor = gr.rows.some((row) => row.some((cell) => cell.merge && cell.merge.anchor));
    ok('富网格：合并区解析出跨度锚点', hasMergeAnchor);
    const existingImgCount = (gr.images || []).length;
    ok(`富网格：提取原表已有图片（${existingImgCount} 张，含定位+dataUrl）`,
      gr.images.every((im) => im.dataUrl && im.w > 0 && im.h > 0));

    // 找一个空单元格写入纯虚构测试文字“甲乙丙”
    let target = null;
    outer:
    for (let r = 1; r <= gr.rowCount; r++) {
      for (let c = 1; c <= gr.columnCount; c++) {
        if (!gr.rows[r - 1][c - 1].text && !gr.rows[r - 1][c - 1].merge.covered) { target = { row: r, col: c }; break outer; }
      }
    }
    doc.setCell(target.row, target.col, '甲乙丙');

    // 就地合成：不产生文件
    const tmpFiles = () => new Set(fs.readdirSync(tmp));
    const before = tmpFiles();
    const items = await doc.compose([target], lib);
    ok('就地合成 1 项且 mode=word', items.length === 1 && items[0].mode === 'word');
    ok('合成阶段不写文件', [...tmpFiles()].every((f) => before.has(f)));
    const it = items[0];

    // 自动放置：充满区域、不超出、宽高比锁定（不变形）
    ok('自动放置不超出区域', it.box.dispW <= it.region.w + 0.5 && it.box.dispH <= it.region.h + 0.5);
    const fillRatio = Math.max(it.box.dispW / it.region.w, it.box.dispH / it.region.h);
    ok(`默认即充满（充满比 ${(fillRatio * 100).toFixed(1)}% ≥ 93%）`, fillRatio >= 0.93);
    ok('自动放置宽高比锁定（不变形）',
      Math.abs(it.box.dispW / it.box.dispH - it.imgW / it.imgH) < 0.02);

    // 合并区感知
    const firstMerge = (doc.ws.model.merges || [])[0];
    if (firstMerge) {
      const m = firstMerge.match(/^([A-Z]+)(\d+):/);
      const col = m[1].split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
      const row = Number(m[2]);
      const region = doc._regionRect(row, col);
      ok(`合并区尺寸大于单格（${region.w}×${region.h}px）`,
        region.w > doc.colWidthsPx[col - 1] || region.h > doc.rowHeightsPx[row - 1]);
    } else {
      console.log('   （样例表无合并区，跳过合并感知测试）');
    }

    // 手动自由拉伸（人工允许变形）
    const stretched = await doc.updateSignature(
      { row: target.row, col: target.col, box: { offX: 0, offY: 0, dispW: it.region.w, dispH: it.region.h } }, lib);
    ok('手动自由拉伸生效（可非等比充满）',
      Math.abs(stretched.box.dispW - it.region.w) < 1 && Math.abs(stretched.box.dispH - it.region.h) < 1);

    // 重生成：回到宽高比锁定（不变形）
    const regen = await doc.updateSignature({ row: target.row, col: target.col, action: 'regenerate' }, lib);
    ok('重生成回到宽高比锁定', Math.abs(regen.box.dispW / regen.box.dispH - regen.imgW / regen.imgH) < 0.02);

    // 对齐
    const aligned = await doc.updateSignature(
      { row: target.row, col: target.col, action: 'align', alignH: 'left', alignV: 'top' }, lib);
    ok('对齐居左居上≈2% 安全边',
      Math.abs(aligned.box.offX - aligned.region.w * 0.02) < 1 && Math.abs(aligned.box.offY - aligned.region.h * 0.02) < 1);

    // 缺字
    doc.setCell(target.row, target.col, '甲丁戊');
    const miss = await doc.compose([target], lib);
    ok('缺字 mode=partial 报告缺字', miss[0].mode === 'partial' && miss[0].missing.includes('戊'));

    // 删除签名 → 恢复（无待导出项）
    doc.deleteSignature(target.row, target.col);
    ok('删除签名后无待导出项', !doc.hasItems());

    // 重新合成并导出
    doc.setCell(target.row, target.col, '甲乙丙');
    doc.setCell(4, 4, '用户编辑保留');
    await doc.compose([target], lib);
    const out = path.join(tmp, 'out.xlsx');
    await doc.writeItems(out);
    ok('导出文件生成', fs.existsSync(out));
    const check = new XlsxDoc();
    const gOut = await check.open(out);
    ok('导出后单元格文字已清空', (gOut.rows[target.row - 1][target.col - 1].text || '') === '');
    const outImgs = check.ws.getImages().length;
    ok(`导出保留原有图片+新签名（原 ${existingImgCount} → 现 ${outImgs}）`, outImgs === existingImgCount + 1);
    ok('导出图片保真：原有图片未丢', (check.grid().images || []).length >= existingImgCount);
    const outRetry = path.join(tmp, 'out-retry.xlsx');
    await doc.writeItems(outRetry);
    const retry = new XlsxDoc();
    await retry.open(outRetry);
    ok('重复导出不会累加重复签名图', retry.ws.getImages().length === existingImgCount + 1);
    ok('连续导出均保留未签名单元格编辑',
      gOut.rows[3][3].text === '用户编辑保留' && retry.grid().rows[3][3].text === '用户编辑保留');
    ok('原文件未被修改（红线 3/8）', hashBefore === md5(sample));
    ok('默认输出名带_已合成', defaultOutPath(sample).includes('_已合成'));
  } else {
    throw new Error(`xlsx 测试样例不存在: ${sample}`);
  }

  if (failures) throw new Error(`${failures} 项测试失败`);
  console.log('\n测试产物目录:', tmp);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
