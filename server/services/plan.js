const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const SCHEMA_PATH = path.join(__dirname, '..', 'templates', 'change-plan-schema.json');
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'change-plan-template.docx');

const CHANGE_METHOD_OPTIONS = ['自动化部署', '手工部署', '自动化+手工部署'];
const MAX_SERVER_ROWS = 200;
const MAX_REQUIREMENT_LENGTH = 10000;
const MAX_TEXT_LENGTH = 5000;
const MAX_SHORT_TEXT_LENGTH = 500;
const MAX_SYSTEM_LENGTH = 160;

let cachedSchema = null;

function getPlanSchema() {
  if (!cachedSchema) {
    cachedSchema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  }
  return cachedSchema;
}

function asText(value, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').trim().slice(0, maxLength).trim();
}

function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 变更需求按行拆分，去重后作为黄色多选的选项。 */
function getRequirementNames(requirementText) {
  const seen = new Set();
  return String(requirementText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
}

function normalizeMultiSelect(value, label, requirementNames, errors) {
  if (!Array.isArray(value)) {
    return [];
  }
  const selected = [];
  const invalid = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (!requirementNames.includes(trimmed)) {
      invalid.push(trimmed);
    } else if (!selected.includes(trimmed)) {
      selected.push(trimmed);
    }
  }
  if (invalid.length) {
    errors.push(`${label}包含无效的变更需求：${invalid.join('、')}`);
  }
  return selected;
}

function normalizeServerRows(rawRows, errors) {
  if (!Array.isArray(rawRows)) {
    errors.push('服务器信息格式不正确');
    return [];
  }
  if (rawRows.length > MAX_SERVER_ROWS) {
    errors.push(`服务器信息最多支持 ${MAX_SERVER_ROWS} 行`);
  }
  const rows = [];
  rawRows.slice(0, MAX_SERVER_ROWS).forEach((row, index) => {
    const source = row && typeof row === 'object' ? row : {};
    const values = {
      assetName: asText(source.assetName, MAX_SHORT_TEXT_LENGTH),
      ip: asText(source.ip, MAX_SHORT_TEXT_LENGTH),
      username: asText(source.username, MAX_SHORT_TEXT_LENGTH),
      assetType: asText(source.assetType, MAX_SHORT_TEXT_LENGTH),
    };
    const filled = Object.values(values).filter(Boolean).length;
    if (!filled) return;
    if (filled < 4) {
      errors.push(`服务器信息第 ${index + 1} 行需完整填写资产名称、IP 地址、用户名、资产类型`);
      return;
    }
    rows.push(values);
  });
  if (!rows.length) {
    errors.push('请至少填写一条完整的服务器信息');
  }
  return rows;
}

function validateAndNormalizePlan(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const schema = getPlanSchema();
  const errors = [];

  const requirementText = asText(source.requirementText, MAX_REQUIREMENT_LENGTH);
  const changeSystem = asText(source.changeSystem, MAX_SYSTEM_LENGTH);
  const expectedChangeDate = asText(source.expectedChangeDate, 10);
  const changeMethod = asText(source.changeMethod, 30);
  const verificationPlan = asText(source.verificationPlan, MAX_REQUIREMENT_LENGTH);

  if (!requirementText) errors.push('变更需求不能为空');
  if (!changeSystem) errors.push('变更系统不能为空');
  if (!expectedChangeDate) {
    errors.push('期望变更日期不能为空');
  } else if (!isValidISODate(expectedChangeDate)) {
    errors.push('期望变更日期格式应为 YYYY-MM-DD');
  }
  if (!CHANGE_METHOD_OPTIONS.includes(changeMethod)) {
    errors.push('请选择有效的变更方式');
  }

  const requirementNames = getRequirementNames(requirementText);
  if (!requirementNames.length) {
    errors.push('变更需求至少需要一条');
  }

  const rawManual = source.manual && typeof source.manual === 'object' ? source.manual : {};
  const manual = {};
  for (const field of schema.manualFields) {
    const maxLength = field.kind === 'input' ? MAX_SHORT_TEXT_LENGTH : MAX_TEXT_LENGTH;
    const value = asText(rawManual[field.key], maxLength);
    if (!value) {
      errors.push(`请填写${field.label}`);
    }
    manual[field.key] = value;
  }

  const serverRows = normalizeServerRows(source.serverRows, errors);

  const dbChanges = normalizeMultiSelect(
    source.dbChanges, '数据库变更', requirementNames, errors,
  );
  const autoDeployChanges = normalizeMultiSelect(
    source.autoDeployChanges, '自动化部署', requirementNames, errors,
  );
  const configFileChanges = normalizeMultiSelect(
    source.configFileChanges, '修改配置文件', requirementNames, errors,
  );

  const data = {
    requirementText,
    changeSystem,
    expectedChangeDate,
    changeMethod,
    verificationPlan,
    manual,
    serverRows,
    dbChanges,
    autoDeployChanges,
    configFileChanges,
  };

  return { data, errors };
}

// 旧版方案记录把每个步骤存成独立字段；读取时合并到新的单输入框字段。
const LEGACY_MANUAL_GROUPS = {
  dbStep1: ['dbStep2', 'dbStep3', 'dbStep4', 'dbStep5'],
  configStep1: ['configStep2'],
  manualStep1: ['manualStep2', 'manualStep3', 'manualStep4', 'manualStep5'],
  appRollbackIntro: [
    'appRollbackStep1',
    'appRollbackStep2',
    'appRollbackStep3',
    'appRollbackStep4',
    'appRollbackStep5',
    'appRollbackStep6',
  ],
};

function normalizePlanData(planData) {
  const data = JSON.parse(JSON.stringify(planData || {}));
  const manual = data.manual && typeof data.manual === 'object' ? data.manual : {};
  for (const [target, extraKeys] of Object.entries(LEGACY_MANUAL_GROUPS)) {
    const extras = extraKeys
      .map((key) => manual[key])
      .filter((value) => typeof value === 'string' && value.trim());
    if (extras.length) {
      manual[target] = [manual[target], ...extras]
        .filter((value) => typeof value === 'string' && value.trim())
        .join('\n');
    }
    for (const key of extraKeys) {
      delete manual[key];
    }
  }
  data.manual = manual;
  return data;
}

function buildPlanDocxContext(data) {
  const suffix = (items) => (items.length ? `（${items.join('、')}）` : '');
  const context = {
    requirementText: data.requirementText,
    changeSystem: data.changeSystem,
    changeMethod: data.changeMethod,
    verificationPlan: data.verificationPlan,
    dbChangesSuffix: suffix(data.dbChanges),
    autoDeployChangesSuffix: suffix(data.autoDeployChanges),
    configFileChangesSuffix: suffix(data.configFileChanges),
    serverRows: data.serverRows,
  };
  for (const [key, value] of Object.entries(data.manual || {})) {
    context[key] = value;
  }
  return context;
}

let templateCheck = null;

/** 检查模板 XML 与 schema 是否一致，结果缓存。 */
function validatePlanTemplate() {
  if (templateCheck) return templateCheck;
  const schema = getPlanSchema();
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  const xml = zip.file('word/document.xml').asText();
  const required = [
    '{requirementText}',
    '{changeSystem}',
    '{changeMethod}',
    '{verificationPlan}',
    '{#serverRows}',
    '{/serverRows}',
    '{assetName}',
    '{ip}',
    '{username}',
    '{assetType}',
  ];
  for (const field of schema.manualFields) required.push(`{${field.key}}`);
  for (const field of schema.multiSelects) required.push(`{${field.key}Suffix}`);

  const missing = required.filter((tag) => !xml.includes(tag));
  templateCheck = { ok: missing.length === 0, missing };
  if (!templateCheck.ok) {
    console.error('[plan] 变更方案模板与 schema 不一致，缺少 tag:', missing.join(', '));
  }
  return templateCheck;
}

module.exports = {
  CHANGE_METHOD_OPTIONS,
  MAX_SERVER_ROWS,
  getPlanSchema,
  getRequirementNames,
  isValidISODate,
  normalizePlanData,
  validateAndNormalizePlan,
  buildPlanDocxContext,
  validatePlanTemplate,
  TEMPLATE_PATH,
};
