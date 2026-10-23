const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { buildDocxContext } = require('./form');
const { toDotDate } = require('./date');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'change-application-template.docx');

function safeFilenamePart(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

/** 文件名格式：{变更系统}+{期望变更日期}+变更申请表.docx */
function makeFilename(data) {
  return `${safeFilenamePart(data.changeSystem, '未命名系统')}+${toDotDate(
    data.expectedChangeDate,
  )}+变更申请表.docx`;
}

function buildDocxBuffer(data) {
  const content = fs.readFileSync(TEMPLATE_PATH);
  const zip = new PizZip(content);
  let document;
  try {
    document = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => '',
    });
    document.render(buildDocxContext(data));
    return document.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
  } catch (error) {
    // docxtemplater 的错误对象包含更具体的模板位置信息
    if (error && error.properties && error.properties.errors) {
      const details = error.properties.errors
        .map((item) => item.properties && item.properties.explanation)
        .filter(Boolean)
        .join('; ');
      throw new Error(details || error.message);
    }
    throw error;
  }
}

function contentDisposition(filename) {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

module.exports = {
  TEMPLATE_PATH,
  makeFilename,
  buildDocxBuffer,
  safeFilenamePart,
  contentDisposition,
};
