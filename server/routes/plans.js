const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');
const {
  PLAN_DIR,
  createPlanRecord,
  listPlanRecords,
  getPlanRecord,
  createPlanTemplate,
  listPlanTemplates,
  getPlanTemplate,
  deletePlanTemplate,
  createPlanSession,
  getPlanSession,
  prunePlanSessions,
  getExportRecord,
  listPlanOptions,
} = require('../db');
const {
  CHANGE_METHOD_OPTIONS,
  getPlanSchema,
  getRequirementNames,
  isValidISODate,
  normalizePlanData,
  validateAndNormalizePlan,
} = require('../services/plan');
const { makePlanFilename, buildPlanDocxBuffer } = require('../services/plan-docx');
const { contentDisposition } = require('../services/docx');

const router = express.Router();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeContext(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const errors = [];

  const changeSystem = typeof source.changeSystem === 'string'
    ? source.changeSystem.trim().slice(0, 160)
    : '';
  const expectedChangeDate = typeof source.expectedChangeDate === 'string'
    ? source.expectedChangeDate.trim()
    : '';
  const verificationPlan = typeof source.verificationPlan === 'string'
    ? source.verificationPlan.trim().slice(0, 10000)
    : '';
  const items = Array.isArray(source.changeItems) ? source.changeItems : [];
  const featureNames = [];
  const seen = new Set();
  for (const item of items) {
    const name = item && typeof item.featureName === 'string'
      ? item.featureName.trim().slice(0, 1000)
      : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    featureNames.push(name);
  }

  if (!changeSystem) errors.push('变更系统不能为空');
  if (!expectedChangeDate) {
    errors.push('期望变更日期不能为空');
  } else if (!isValidISODate(expectedChangeDate)) {
    errors.push('期望变更日期格式应为 YYYY-MM-DD');
  }
  if (!featureNames.length) errors.push('变更内容不能为空');

  return {
    errors,
    context: {
      featureNames,
      changeSystem,
      expectedChangeDate,
      verificationPlan,
      sourceApplicationRecordId: parseId(source.sourceApplicationRecordId),
    },
  };
}

/** 旧版方案缺少变更验证方案时，尝试从关联的变更申请表记录补全。 */
async function resolvePlanData(record) {
  const planData = normalizePlanData(record.planData);
  if (!planData.verificationPlan && record.sourceApplicationRecordId) {
    const application = await getExportRecord(record.sourceApplicationRecordId);
    const verificationPlan = application && application.formData
      ? application.formData.verificationPlan
      : '';
    if (typeof verificationPlan === 'string') {
      planData.verificationPlan = verificationPlan;
    }
  }
  return planData;
}

async function pruneSessions() {
  const before = new Date(Date.now() - SESSION_TTL_MS).toISOString();
  await prunePlanSessions(before);
}

/** 获取方案表单初始化数据 */
router.get('/init', async (req, res, next) => {
  try {
    const [templates, planOptions] = await Promise.all([
      listPlanTemplates(),
      listPlanOptions(),
    ]);
    res.json({
      schema: getPlanSchema(),
      changeMethodOptions: CHANGE_METHOD_OPTIONS,
      templates,
      planOptions,
    });
  } catch (error) {
    next(error);
  }
});

/** 保存申请表中的上下文，供方案编辑页读取 */
router.post('/session', async (req, res, next) => {
  try {
    const { context, errors } = normalizeContext(req.body);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }
    await pruneSessions();
    const sessionId = crypto.randomUUID();
    await createPlanSession({
      id: sessionId,
      context,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ sessionId });
  } catch (error) {
    next(error);
  }
});

router.get('/session/:id', async (req, res, next) => {
  try {
    const session = await getPlanSession(req.params.id);
    if (!session) {
      return res.status(404).json({ message: '变更方案会话不存在或已过期，请返回申请表重新进入' });
    }
    const age = Date.now() - new Date(session.createdAt).getTime();
    if (age > SESSION_TTL_MS) {
      return res.status(410).json({ message: '变更方案会话已过期，请返回申请表重新进入' });
    }
    res.json({ session });
  } catch (error) {
    next(error);
  }
});

router.get('/templates', async (req, res, next) => {
  try {
    const templates = await listPlanTemplates();
    res.json({ templates, total: templates.length });
  } catch (error) {
    next(error);
  }
});

router.get('/templates/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: '无效的模板 ID' });
    const template = await getPlanTemplate(id);
    if (!template) return res.status(404).json({ message: '变更方案模板不存在' });
    res.json({ template: { ...template, planData: normalizePlanData(template.planData) } });
  } catch (error) {
    next(error);
  }
});

router.delete('/templates/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: '无效的模板 ID' });
    const changes = await deletePlanTemplate(id);
    if (!changes) return res.status(404).json({ message: '变更方案模板不存在' });
    res.json({ message: '模板已删除' });
  } catch (error) {
    next(error);
  }
});

/** 以历史方案记录保存为模板 */
router.post('/:id/template', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: '无效的记录 ID' });
    const record = await getPlanRecord(id);
    if (!record) return res.status(404).json({ message: '变更方案记录不存在' });

    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : '';
    if (!name) return res.status(400).json({ message: '请填写模板名称' });

    try {
      const templateId = await createPlanTemplate({
        name,
        planData: await resolvePlanData(record),
        sourcePlanRecordId: record.id,
      });
      const template = await getPlanTemplate(templateId);
      res.status(201).json({ message: '已保存为模板', template });
    } catch (error) {
      if (error && error.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({ message: '该模板名称已存在' });
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

/** 生成变更方案 Word、写入磁盘并保存留痕 */
router.post('/', async (req, res, next) => {
  let storedFile = '';
  try {
    const { data, errors } = validateAndNormalizePlan(req.body);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const sourcePlanRecordId = parseId(req.body.sourceRecordId);
    if (sourcePlanRecordId) {
      const sourceRecord = await getPlanRecord(sourcePlanRecordId);
      if (!sourceRecord) {
        return res.status(400).json({ message: '用于重新编辑的历史方案记录不存在' });
      }
    }

    const sourceApplicationRecordId = parseId(req.body.sourceApplicationRecordId);
    const templateId = parseId(req.body.templateId);

    const fileName = makePlanFilename(data);
    const buffer = buildPlanDocxBuffer(data);
    storedFile = path.join(PLAN_DIR, `${Date.now()}-${crypto.randomUUID()}.docx`);
    await fsp.writeFile(storedFile, buffer);

    let recordId;
    try {
      recordId = await createPlanRecord({
        exportedAt: new Date().toISOString(),
        fileName,
        filePath: path.basename(storedFile),
        planData: data,
        changeSystem: data.changeSystem,
        expectedChangeDate: data.expectedChangeDate,
        sourcePlanRecordId: sourcePlanRecordId || null,
        sourceApplicationRecordId: sourceApplicationRecordId || null,
        templateId: templateId || null,
      });
    } catch (error) {
      await fsp.unlink(storedFile).catch(() => {});
      throw error;
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', contentDisposition(fileName));
    res.setHeader('X-Record-Id', String(recordId));
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Record-Id');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    if (storedFile) await fsp.unlink(storedFile).catch(() => {});
    console.error('[plan-export] failed:', error);
    if (error && /模板|placeholders|unclosed|unopened|占位符/i.test(error.message || '')) {
      return res.status(500).json({ message: '变更方案模板渲染失败，请检查服务器日志' });
    }
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const records = await listPlanRecords();
    res.json({ records, total: records.length });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: '无效的记录 ID' });
    const record = await getPlanRecord(id);
    if (!record) return res.status(404).json({ message: '变更方案记录不存在' });
    res.json({ record: { ...record, planData: await resolvePlanData(record) } });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/file', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: '无效的记录 ID' });
    const record = await getPlanRecord(id);
    if (!record) return res.status(404).json({ message: '变更方案记录不存在' });

    const storedPath = path.join(PLAN_DIR, path.basename(record.filePath));
    if (!fs.existsSync(storedPath)) {
      return res.status(404).json({ message: '原始 Word 文件已不存在，仅保留表单数据' });
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', contentDisposition(record.fileName));
    res.sendFile(storedPath);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
