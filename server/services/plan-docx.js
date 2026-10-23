const fs = require('fs');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { toDotDate } = require('./date');
const { safeFilenamePart, contentDisposition } = require('./docx');
const {
  TEMPLATE_PATH,
  buildPlanDocxContext,
  validatePlanTemplate,
} = require('./plan');

/** 文件名格式：{变更系统}+{期望变更日期}+变更方案.docx */
function makePlanFilename(data) {
  return `${safeFilenamePart(data.changeSystem, '未命名系统')}+${toDotDate(
    data.expectedChangeDate,
  )}+变更方案.docx`;
}

function buildPlanDocxBuffer(data) {
  const templateCheck = validatePlanTemplate();
  if (!templateCheck.ok) {
    throw new Error(`变更方案模板缺少占位符：${templateCheck.missing.join(', ')}`);
  }

  const content = fs.readFileSync(TEMPLATE_PATH);
  const zip = new PizZip(content);
  let document;
  try {
    document = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => '',
    });
    document.render(buildPlanDocxContext(data));
    return document.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
  } catch (error) {
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

module.exports = {
  TEMPLATE_PATH,
  makePlanFilename,
  buildPlanDocxBuffer,
  contentDisposition,
};
