const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');
const {
  EXPORT_DIR,
  createExportRecord,
  listExportRecords,
  getExportRecord,
} = require('../db');
const { validateAndNormalize } = require('../services/form');
const {
  makeFilename,
  buildDocxBuffer,
  contentDisposition,
} = require('../services/docx');

const router = express.Router();

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** 生成 Word、写入磁盘，并保存完整导出留痕 */
router.post('/', async (req, res, next) => {
  let storedFile = '';
  try {
    const { data, errors } = validateAndNormalize(req.body);
    if (errors.length) {
      return res.status(400).json({
        message: errors[0],
        errors,
      });
    }

    const sourceRecordId = parseId(req.body.sourceRecordId);
    if (sourceRecordId) {
      const sourceRecord = await getExportRecord(sourceRecordId);
      if (!sourceRecord) {
        return res.status(400).json({ message: '用于重新编辑的历史记录不存在' });
      }
    }

    const fileName = makeFilename(data);
    const buffer = buildDocxBuffer(data);
    storedFile = path.join(EXPORT_DIR, `${Date.now()}-${crypto.randomUUID()}.docx`);
    await fsp.writeFile(storedFile, buffer);

    let recordId;
    try {
      recordId = await createExportRecord({
        exportedAt: new Date().toISOString(),
        fileName,
        filePath: path.basename(storedFile),
        formData: { ...data, sourceRecordId: sourceRecordId || null },
        changeSystem: data.changeSystem,
        applicant: data.applicant,
        expectedChangeDate: data.expectedChangeDate,
        sourceRecordId,
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
    console.error('[export] failed:', error);
    if (error && /template|placeholders|unclosed|unopened/i.test(error.message || '')) {
      return res.status(500).json({ message: 'Word 模板渲染失败，请检查服务器日志' });
    }
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const records = await listExportRecords();
    res.json({ records, total: records.length });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: '无效的记录 ID' });
    const record = await getExportRecord(id);
    if (!record) return res.status(404).json({ message: '导出记录不存在' });
    res.json({ record });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/file', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: '无效的记录 ID' });
    const record = await getExportRecord(id);
    if (!record) return res.status(404).json({ message: '导出记录不存在' });

    const storedPath = path.join(EXPORT_DIR, path.basename(record.filePath));
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
