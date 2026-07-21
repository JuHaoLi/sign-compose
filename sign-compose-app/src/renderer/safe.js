'use strict';

/** 将不可信文本安全地放入 innerHTML 文本或属性位置。 */
window.safeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[ch]));
