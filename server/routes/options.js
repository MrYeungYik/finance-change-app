const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const {
  OPTION_GROUPS,
  listOptions,
  addOption,
  deleteOption,
  importOptionValues,
} = require('../db');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

const HEADER_VALUES = new Set(['value', '选项', '值', '选项名称']);
const HEADER_GROUPS = new Set(['group', '分组', '组']);
const GROUP_BY_LABEL = new Map(Object.entries(OPTION_GROUPS).map(([key, label]) => [label, key]));

function isValidGroup(group) {
  return Object.prototype.hasOwnProperty.call(OPTION_GROUPS, group);
}

function normalizeGroup(raw) {
  if (isValidGroup(raw)) return raw;
  return GROUP_BY_LABEL.get(String(raw || '').trim()) || '';
}

router.get('/', async (req, res, next) => {
  try {
    const groups = await listOptions();
    res.json({ groups, groupLabels: OPTION_GROUPS });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const group = normalizeGroup(req.body.group);
    const value = String(req.body.value || '').trim();
    if (!group) return res.status(400).json({ message: '请选择有效的选项分组' });
    if (!value) return res.status(400).json({ message: '选项内容不能为空' });
    if (value.length > 120) return res.status(400).json({ message: '选项内容不能超过 120 个字符' });

    const created = await addOption(group, value);
    res.status(201).json({ message: '选项已添加', option: created });
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ message: '该选项已存在，无需重复添加' });
    }
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: '无效的选项 ID' });
    }
    const result = await deleteOption(id);
    if (!result.changes) return res.status(404).json({ message: '选项不存在或已被删除' });
    res.json({ message: '选项已删除' });
  } catch (error) {
    next(error);
  }
});

router.post('/import', upload.single('file'), async (req, res, next) => {
  try {
    const group = normalizeGroup(req.body.group);
    if (!group) return res.status(400).json({ message: '请先选择要导入的选项分组' });
    if (!req.file) return res.status(400).json({ message: '请选择 CSV 文件' });
    if (!/\.csv$/i.test(req.file.originalname || '')) {
      return res.status(400).json({ message: '仅支持 .csv 格式文件' });
    }

    const text = req.file.buffer.toString('utf8').replace(/^﻿/, '');
    let rows;
    try {
      rows = parse(text, {
        bom: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
    } catch (error) {
      return res.status(400).json({ message: `CSV 解析失败：${error.message}` });
    }

    rows = rows.filter((row) => row.some((cell) => String(cell || '').trim()));
    if (!rows.length) return res.status(400).json({ message: 'CSV 文件中没有可导入的内容' });

    // 支持三种格式：
    // 1. 一列值（最常用，配合页面选择的分组）
    // 2. value 表头 + 一列值
    // 3. group,value 两列表格
    const firstRow = rows[0].map((cell) => String(cell || '').trim());
    const lowerFirst = firstRow.map((cell) => cell.toLowerCase());
    const hasGroupValueHeader =
      lowerFirst.includes('group') &&
      lowerFirst.includes('value') &&
      rows.length > 1;

    let values = [];
    let tableRows = rows;

    if (hasGroupValueHeader) {
      const header = lowerFirst;
      const groupIndex = header.indexOf('group');
      const valueIndex = header.indexOf('value');
      tableRows = rows.slice(1);
      values = tableRows
        .filter((row) => normalizeGroup(row[groupIndex]) === group)
        .map((row) => String(row[valueIndex] || '').trim());
    } else {
      const isSimpleHeader =
        firstRow.length === 1 && HEADER_VALUES.has(lowerFirst[0]);
      const isGroupHeader =
        firstRow.length > 1 && HEADER_GROUPS.has(lowerFirst[0]);
      if (isSimpleHeader || isGroupHeader) tableRows = rows.slice(1);
      values = tableRows.map((row) => String(row[0] || '').trim());
    }

    values = values.filter(Boolean);
    if (!values.length) {
      return res.status(400).json({ message: 'CSV 中没有找到属于该分组的有效选项' });
    }
    if (values.some((value) => value.length > 120)) {
      return res.status(400).json({ message: 'CSV 中存在超过 120 个字符的选项' });
    }

    const result = await importOptionValues(group, values);
    res.json({
      message: `导入完成：新增 ${result.added} 项，跳过 ${result.skipped} 项`,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
