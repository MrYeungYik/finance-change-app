const express = require('express');
const { listOptions } = require('../db');
const { todayISO, addDaysISO } = require('../services/date');

const router = express.Router();

function buildDefaults() {
  const today = todayISO();
  const expectedDate = addDaysISO(today, 7);

  return {
    applicant: '蒋中正',
    department: '研发二中心',
    applicationDate: today,
    devOwnerA: '蒋中正',
    devOwnerB: '蒋经国',
    changeSystem: '财务管理系统',
    needsReport: '否',
    expectedChangeDate: expectedDate,
    changeItems: [
      { category: '需求', featureName: 'fastjson升级至2.0.64' },
      { category: '优化', featureName: '优化用户重复绑定ukey' },
    ],
    riskDescription: '无风险',
    relatedChange: '是',
    relatedSystems: 'AA系统、BB系统、CC系统',
    databaseChanges: ['表结构'],
    ddlDml: '',
    networkChanges: ['网络'],
    networkChangeTime: expectedDate,
    resourceChangeTime: '',
    implementationPlan: '自动化部署接入中，此次上线使用手工部署。',
    rollbackPlan: '参考变更操作手册',
    verifier1: '蒋中正',
    verifierContact: '15970232411',
    nextDayDuty: '蒋中正',
    dutyContact: '15970232411',
    verificationPlan: '1、司库系统登录页面正常',
  };
}

/** 获取服务端日期、示例默认值和下拉选项 */
router.get('/init', async (req, res, next) => {
  try {
    const options = await listOptions();
    res.json({
      applicationDate: todayISO(),
      defaults: buildDefaults(),
      groups: options,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/date', (req, res) => {
  res.json({ applicationDate: todayISO() });
});

module.exports = router;
