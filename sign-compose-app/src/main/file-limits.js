'use strict';

const fs = require('fs');
const JSZip = require('jszip');

const MIB = 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * MIB;
const MAX_IMAGE_PIXELS = 80_000_000;
const MAX_XLSX_BYTES = 50 * MIB;
const MAX_XLSX_ENTRIES = 5_000;
const MAX_XLSX_UNCOMPRESSED_BYTES = 250 * MIB;
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 256;
const MAX_GRID_CELLS = 200_000;

function assertFileSize(filePath, maxBytes, label) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`${label}不是普通文件`);
  if (stat.size > maxBytes) throw new Error(`${label}过大，最大允许 ${Math.floor(maxBytes / MIB)} MB`);
  return stat.size;
}

async function validateXlsxArchive(filePath) {
  assertFileSize(filePath, MAX_XLSX_BYTES, '表格文件');
  const buffer = await fs.promises.readFile(filePath);
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (_) {
    throw new Error('表格文件不是有效的 xlsx 压缩包');
  }
  const entries = Object.values(zip.files);
  assertArchiveShape(entries);
}

function assertArchiveShape(entries) {
  if (entries.length > MAX_XLSX_ENTRIES) throw new Error('表格文件包含过多内部条目');
  const uncompressedBytes = entries.reduce((sum, entry) => (
    sum + Number((entry && entry._data && entry._data.uncompressedSize) || 0)
  ), 0);
  if (uncompressedBytes > MAX_XLSX_UNCOMPRESSED_BYTES) {
    throw new Error('表格解压后体积过大，已拒绝打开');
  }
}

function assertWorksheetBounds(rowCount, columnCount) {
  if (
    rowCount > MAX_ROWS || columnCount > MAX_COLUMNS ||
    rowCount * columnCount > MAX_GRID_CELLS
  ) {
    throw new Error('表格范围过大，无法安全地在当前版本中打开');
  }
}

module.exports = {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_XLSX_ENTRIES,
  MAX_XLSX_UNCOMPRESSED_BYTES,
  assertFileSize,
  assertArchiveShape,
  assertWorksheetBounds,
  validateXlsxArchive,
};
