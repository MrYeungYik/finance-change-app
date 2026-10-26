const express = require('express');
const {
  listPlanOptions,
  addPlanAssetOption,
  deletePlanAssetOption,
  addPlanIpOption,
  deletePlanIpOption,
} = require('../db');

const router = express.Router();

const ASSET_KINDS = {
  assetName: '资产名称',
  assetType: '资产类型',
};
const MAX_SYSTEM_LENGTH = 160;
const MAX_NAME_LENGTH = 200;

function text(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength).trim() : '';
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get('/', async (req, res, next) => {
  try {
    res.json({ ...(await listPlanOptions()), assetKinds: ASSET_KINDS });
  } catch (error) {
    next(error);
  }
});

/** 新增按变更系统维护的资产名称/资产类型 */
router.post('/assets', async (req, res, next) => {
  try {
    const systemName = text(req.body?.systemName, MAX_SYSTEM_LENGTH);
    const kind = text(req.body?.kind, 40);
    const value = text(req.body?.value, MAX_NAME_LENGTH);
    if (!systemName) return res.status(400).json({ message: '请先选择变更系统' });
    if (!Object.prototype.hasOwnProperty.call(ASSET_KINDS, kind)) {
      return res.status(400).json({ message: '请选择有效的资产选项类型' });
    }
    if (!value) return res.status(400).json({ message: `${ASSET_KINDS[kind]}不能为空` });

    const option = await addPlanAssetOption({ systemName, kind, value });
    res.status(201).json({ message: '选项已添加', option });
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ message: '该选项已存在，无需重复添加' });
    }
    next(error);
  }
});

router.delete('/assets/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: '无效的选项 ID' });
    const result = await deletePlanAssetOption(id);
    if (!result.changes) return res.status(404).json({ message: '选项不存在或已被删除' });
    res.json({ message: '选项已删除' });
  } catch (error) {
    next(error);
  }
});

/** 新增按资产名称维护的 IP 地址 */
router.post('/ips', async (req, res, next) => {
  try {
    const assetName = text(req.body?.assetName, MAX_NAME_LENGTH);
    const value = text(req.body?.value, MAX_NAME_LENGTH);
    if (!assetName) return res.status(400).json({ message: '请先选择资产名称' });
    if (!value) return res.status(400).json({ message: 'IP 地址不能为空' });

    const option = await addPlanIpOption({ assetName, value });
    res.status(201).json({ message: '选项已添加', option });
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ message: '该 IP 已存在，无需重复添加' });
    }
    next(error);
  }
});

router.delete('/ips/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: '无效的选项 ID' });
    const result = await deletePlanIpOption(id);
    if (!result.changes) return res.status(404).json({ message: '选项不存在或已被删除' });
    res.json({ message: '选项已删除' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
