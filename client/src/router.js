import { createRouter, createWebHistory } from 'vue-router';
import ApplicationForm from './views/ApplicationForm.vue';
import ChangePlanForm from './views/ChangePlanForm.vue';
import ChangePlanRecords from './views/ChangePlanRecords.vue';
import ExportRecords from './views/ExportRecords.vue';
import OptionsManage from './views/OptionsManage.vue';
import AssetOptions from './views/AssetOptions.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/form' },
    { path: '/form', name: 'form', component: ApplicationForm, meta: { title: '填写申请表' } },
    { path: '/records', name: 'records', component: ExportRecords, meta: { title: '导出记录查询' } },
    {
      path: '/plans/new',
      name: 'plan-form',
      component: ChangePlanForm,
      meta: { title: '编辑变更方案' },
    },
    {
      path: '/plans',
      name: 'plan-records',
      component: ChangePlanRecords,
      meta: { title: '变更方案记录' },
    },
    { path: '/options', name: 'options', component: OptionsManage, meta: { title: '下拉选项维护' } },
    {
      path: '/asset-options',
      name: 'asset-options',
      component: AssetOptions,
      meta: { title: '资产选项维护' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/form' },
  ],
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;
    return { top: 0 };
  },
});

router.afterEach((to) => {
  document.title = `${to.meta.title || '变更申请'} · 财务管理系统`;
});

export default router;
