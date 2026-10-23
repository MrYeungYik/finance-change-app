const { todayISO, toDotDate } = require('./date');

const DATABASE_CHOICES = ['表结构', '索引', '触发器', '存储过程'];
const NETWORK_CHOICES = ['网络', '资源'];
const MAX_CHANGE_ITEMS = 50;

function asText(value, maxLength = 2000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength).trim();
}

function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeChoices(value, allowed, label, errors) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    errors.push(`${label}格式不正确`);
    return [];
  }
  const invalid = value.filter((item) => !allowed.includes(item));
  if (invalid.length) {
    errors.push(`${label}包含无效选项：${invalid.join('、')}`);
  }
  return allowed.filter((item) => value.includes(item));
}

/**
 * 校验并标准化前端提交的数据。
 * 申请日期永远以服务端当前日期为准，客户端传入值会被忽略。
 */
function validateAndNormalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const errors = [];
  const maxLengths = {
    applicant: 80,
    department: 120,
    devOwnerA: 80,
    devOwnerB: 80,
    changeSystem: 160,
    expectedChangeDate: 10,
    riskDescription: 5000,
    relatedSystems: 1000,
    ddlDml: 5000,
    networkChangeTime: 60,
    resourceChangeTime: 60,
    implementationPlan: 10000,
    rollbackPlan: 10000,
    verifier1: 80,
    verifierContact: 120,
    nextDayDuty: 80,
    dutyContact: 120,
    verificationPlan: 10000,
  };

  const data = {
    applicant: asText(source.applicant, maxLengths.applicant),
    department: asText(source.department, maxLengths.department),
    applicationDate: todayISO(),
    devOwnerA: asText(source.devOwnerA, maxLengths.devOwnerA),
    devOwnerB: asText(source.devOwnerB, maxLengths.devOwnerB),
    changeSystem: asText(source.changeSystem, maxLengths.changeSystem),
    needsReport: asText(source.needsReport, 2),
    expectedChangeDate: asText(source.expectedChangeDate, 10),
    changeItems: [],
    riskDescription: asText(source.riskDescription, maxLengths.riskDescription),
    relatedChange: asText(source.relatedChange, 2),
    relatedSystems: asText(source.relatedSystems, maxLengths.relatedSystems),
    databaseChanges: [],
    ddlDml: asText(source.ddlDml, maxLengths.ddlDml),
    networkChanges: [],
    networkChangeTime: asText(source.networkChangeTime, maxLengths.networkChangeTime),
    resourceChangeTime: asText(source.resourceChangeTime, maxLengths.resourceChangeTime),
    implementationPlan: asText(source.implementationPlan, maxLengths.implementationPlan),
    rollbackPlan: asText(source.rollbackPlan, maxLengths.rollbackPlan),
    verifier1: asText(source.verifier1, maxLengths.verifier1),
    verifierContact: asText(source.verifierContact, maxLengths.verifierContact),
    nextDayDuty: asText(source.nextDayDuty, maxLengths.nextDayDuty),
    dutyContact: asText(source.dutyContact, maxLengths.dutyContact),
    verificationPlan: asText(source.verificationPlan, maxLengths.verificationPlan),
  };

  const requiredFields = [
    ['applicant', '变更申请人'],
    ['department', '申请部门'],
    ['changeSystem', '变更系统'],
    ['expectedChangeDate', '期望变更日期'],
    ['riskDescription', '变更影响及范围说明'],
    ['implementationPlan', '变更实施方案'],
    ['rollbackPlan', '数据及程序的备份回退方案'],
    ['verifier1', '变更验证人1'],
    ['verifierContact', '变更验证人联系方式'],
    ['nextDayDuty', '次日值守人员'],
    ['dutyContact', '值守人员联系方式'],
    ['verificationPlan', '变更验证方案'],
  ];
  for (const [field, label] of requiredFields) {
    if (!data[field]) errors.push(`${label}不能为空`);
  }

  if (!['是', '否'].includes(data.needsReport)) {
    errors.push('请选择是否需要报备');
  }
  if (!['是', '否'].includes(data.relatedChange)) {
    errors.push('请选择是否涉及其他系统关联变更');
  }
  if (data.relatedChange === '是' && !data.relatedSystems) {
    errors.push('涉及关联变更时，请填写关联系统');
  }
  if (data.relatedChange === '否') {
    data.relatedSystems = '';
  }

  if (data.expectedChangeDate && !isValidISODate(data.expectedChangeDate)) {
    errors.push('期望变更日期格式应为 YYYY-MM-DD');
  }

  const rawItems = Array.isArray(source.changeItems) ? source.changeItems : [];
  rawItems.slice(0, MAX_CHANGE_ITEMS).forEach((item, index) => {
    const category = asText(item && item.category, 120);
    const featureName = asText(item && item.featureName, 1000);
    // 完全空白的行直接忽略，避免用户新增行后未填写导致无法导出
    if (!category && !featureName) return;
    if (!category || !featureName) {
      errors.push(`变更功能点第 ${index + 1} 行需同时填写变更类别和功能点名称`);
      return;
    }
    data.changeItems.push({ category, featureName });
  });
  if (!data.changeItems.length && !errors.some((message) => message.includes('变更功能点'))) {
    errors.push('请至少填写一条变更功能点');
  }
  if (rawItems.length > MAX_CHANGE_ITEMS) {
    errors.push(`变更功能点最多支持 ${MAX_CHANGE_ITEMS} 行`);
  }

  data.databaseChanges = normalizeChoices(
    source.databaseChanges,
    DATABASE_CHOICES,
    '是否涉及数据库',
    errors,
  );
  data.networkChanges = normalizeChoices(
    source.networkChanges,
    NETWORK_CHOICES,
    '是否涉及网络和资源变更',
    errors,
  );

  if (data.networkChanges.includes('网络') && !data.networkChangeTime) {
    errors.push('已选择网络变更，请填写网络变更时间');
  }
  if (data.networkChanges.includes('资源') && !data.resourceChangeTime) {
    errors.push('已选择资源变更，请填写资源变更时间');
  }

  // 关键长度校验（asText 已截断，这里通过比较原始值给出明确提示）
  const lengthLabels = {
    applicant: '变更申请人',
    department: '申请部门',
    devOwnerA: '开发负责人 A',
    devOwnerB: '开发负责人 B',
    changeSystem: '变更系统',
    expectedChangeDate: '期望变更日期',
    riskDescription: '变更风险说明',
    relatedSystems: '关联系统',
    ddlDml: 'DDL 与 DML',
    networkChangeTime: '网络变更时间',
    resourceChangeTime: '资源变更时间',
    implementationPlan: '变更实施方案',
    rollbackPlan: '备份回退方案',
    verifier1: '变更验证人 1',
    verifierContact: '验证人联系方式',
    nextDayDuty: '次日值守人员',
    dutyContact: '值守人员联系方式',
    verificationPlan: '变更验证方案',
  };
  for (const [field, max] of Object.entries(maxLengths)) {
    if (typeof source[field] === 'string' && source[field].trim().length > max) {
      errors.push(`${lengthLabels[field] || field}不能超过 ${max} 个字符`);
    }
  }

  return { data, errors };
}

function mark(selected) {
  return selected ? '●' : '○';
}

/** 生成 docxtemplater 渲染上下文 */
function buildDocxContext(data) {
  const hasNetwork = data.networkChanges.includes('网络');
  const hasResource = data.networkChanges.includes('资源');

  return {
    applicant: data.applicant,
    department: data.department,
    applicationDateText: toDotDate(data.applicationDate),
    devOwnerA: data.devOwnerA,
    devOwnerB: data.devOwnerB,
    changeSystem: data.changeSystem,
    reportYesMark: mark(data.needsReport === '是'),
    reportNoMark: mark(data.needsReport === '否'),
    expectedChangeDateText: toDotDate(data.expectedChangeDate),
    changeItems: data.changeItems.map((item, index) => ({
      seq: index + 1,
      category: item.category,
      featureName: item.featureName,
    })),
    riskDescription: data.riskDescription,
    relatedChangeYesMark: mark(data.relatedChange === '是'),
    relatedChangeNoMark: mark(data.relatedChange === '否'),
    relatedSystemsText: data.relatedChange === '是' ? data.relatedSystems : '不涉及',
    dbStructureMark: mark(data.databaseChanges.includes('表结构')),
    dbIndexMark: mark(data.databaseChanges.includes('索引')),
    dbTriggerMark: mark(data.databaseChanges.includes('触发器')),
    dbProcedureMark: mark(data.databaseChanges.includes('存储过程')),
    ddlDml: data.ddlDml || '不涉及',
    networkMark: mark(hasNetwork),
    resourceMark: mark(hasResource),
    networkChangeTimeText: hasNetwork ? toDotDate(data.networkChangeTime) : '不涉及',
    resourceChangeTimeText: hasResource ? toDotDate(data.resourceChangeTime) : '不涉及',
    implementationPlan: data.implementationPlan,
    rollbackPlan: data.rollbackPlan,
    verifier1: data.verifier1,
    verifierContact: data.verifierContact,
    nextDayDuty: data.nextDayDuty,
    dutyContact: data.dutyContact,
    verificationPlan: data.verificationPlan,
  };
}

module.exports = {
  DATABASE_CHOICES,
  NETWORK_CHOICES,
  validateAndNormalize,
  buildDocxContext,
};
