<script setup>
import { computed } from 'vue';
import { formatDateDot, formatDateTime } from '../utils/format';

const props = defineProps({
  record: { type: Object, required: true },
});

const form = computed(() => props.record.planData || {});
const manual = computed(() => form.value.manual || {});
const requirementLines = computed(() =>
  String(form.value.requirementText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
);
const serverRows = computed(() =>
  Array.isArray(form.value.serverRows) ? form.value.serverRows : [],
);

const stepSections = [
  {
    key: 'db',
    title: '数据库变更',
    changes: 'dbChanges',
    fields: [['dbStep1', '数据库变更步骤']],
  },
  {
    key: 'auto',
    title: '自动化部署',
    changes: 'autoDeployChanges',
    fields: [],
  },
  {
    key: 'config',
    title: '修改配置文件',
    changes: 'configFileChanges',
    fields: [['configStep1', '配置文件修改步骤']],
  },
  {
    key: 'manual',
    title: '手工变更',
    changes: null,
    fields: [['manualStep1', '手工变更步骤']],
  },
];

const rollbackFields = [
  ['appRollbackIntro', '应用回退内容'],
  ['dbRollback', '数据库回退'],
];
</script>

<template>
  <div class="record-detail plan-record-detail">
    <div class="detail-hero">
      <p class="eyebrow">PLAN RECORD #{{ String(record.id).padStart(4, '0') }}</p>
      <h3>{{ record.fileName }}</h3>
      <p>
        导出时间：{{ formatDateTime(record.exportedAt) }}
        · 期望变更日期：{{ formatDateDot(record.expectedChangeDate) }}
      </p>
    </div>

    <section class="detail-section">
      <h4 class="detail-section-title">基础信息</h4>
      <dl class="detail-grid">
        <div class="detail-field full">
          <dt>变更需求</dt>
          <dd class="plan-requirement-lines">
            <span v-for="line in requirementLines" :key="line">{{ line }}</span>
            <span v-if="!requirementLines.length">—</span>
          </dd>
        </div>
        <div class="detail-field">
          <dt>变更系统</dt>
          <dd>{{ form.changeSystem || '—' }}</dd>
        </div>
        <div class="detail-field">
          <dt>期望变更日期</dt>
          <dd>{{ formatDateDot(form.expectedChangeDate) }}</dd>
        </div>
        <div class="detail-field">
          <dt>变更方式</dt>
          <dd>{{ form.changeMethod || '—' }}</dd>
        </div>
      </dl>
    </section>

    <section class="detail-section">
      <h4 class="detail-section-title">变更文件清单</h4>
      <dl class="detail-grid">
        <div class="detail-field">
          <dt>变更包</dt>
          <dd>{{ manual.packageFile || '—' }}</dd>
        </div>
        <div class="detail-field full">
          <dt>说明</dt>
          <dd class="plan-manual-text">{{ manual.packageNote || '—' }}</dd>
        </div>
      </dl>
    </section>

    <section class="detail-section">
      <h4 class="detail-section-title">变更操作服务器和用户</h4>
      <div v-if="serverRows.length" class="plan-server-table">
        <div class="plan-server-head">
          <span>资产名称</span>
          <span>IP 地址</span>
          <span>用户名</span>
          <span>资产类型</span>
        </div>
        <div v-for="(row, index) in serverRows" :key="index" class="plan-server-row">
          <span>{{ row.assetName }}</span>
          <span>{{ row.ip }}</span>
          <span>{{ row.username }}</span>
          <span>{{ row.assetType }}</span>
        </div>
      </div>
      <p v-else class="detail-empty">未填写服务器信息</p>
    </section>

    <section class="detail-section">
      <h4 class="detail-section-title">变更操作步骤</h4>
      <div v-for="section in stepSections" :key="section.key" class="plan-step-block">
        <h5>{{ section.title }}</h5>
        <div v-if="section.changes" class="plan-tag-list">
          <el-tag
            v-for="item in form[section.changes] || []"
            :key="item"
            size="small"
            effect="plain"
          >
            {{ item }}
          </el-tag>
          <span v-if="!(form[section.changes] || []).length" class="plan-muted">未选择变更需求</span>
        </div>
        <dl v-if="section.fields.length" class="detail-grid">
          <div v-for="[key, label] in section.fields" :key="key" class="detail-field full">
            <dt>{{ label }}</dt>
            <dd class="plan-manual-text">{{ manual[key] || '—' }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <section class="detail-section">
      <h4 class="detail-section-title">变更回退方案</h4>
      <dl class="detail-grid">
        <div v-for="[key, label] in rollbackFields" :key="key" class="detail-field full">
          <dt>{{ label }}</dt>
          <dd class="plan-manual-text">{{ manual[key] || '—' }}</dd>
        </div>
      </dl>
    </section>

    <section class="detail-section">
      <h4 class="detail-section-title">变更验证方案</h4>
      <p class="plan-manual-text">{{ form.verificationPlan || '—' }}</p>
    </section>
  </div>
</template>

<style scoped>
.plan-requirement-lines {
  display: grid;
  gap: 2px;
  white-space: pre-wrap;
}

.plan-manual-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.plan-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.plan-muted {
  color: var(--ink-400);
  font-size: 12px;
}

.plan-step-block {
  padding: 4px 0 2px;
}

.plan-step-block + .plan-step-block {
  margin-top: 12px;
  padding-top: 14px;
  border-top: 1px dashed var(--line);
}

.plan-step-block h5 {
  margin-bottom: 8px;
  color: var(--ink-800);
  font-size: 13px;
}

.plan-server-table {
  border: 1px solid var(--line);
  border-radius: 11px;
  overflow: hidden;
}

.plan-server-head,
.plan-server-row {
  display: grid;
  grid-template-columns: minmax(140px, 1.2fr) minmax(170px, 1.4fr) minmax(110px, 1fr) minmax(110px, 1fr);
  gap: 10px;
  padding: 9px 12px;
  font-size: 12px;
}

.plan-server-head {
  color: var(--ink-500);
  background: var(--paper-soft);
  border-bottom: 1px solid var(--line);
  font-weight: 600;
}

.plan-server-row + .plan-server-row {
  border-top: 1px solid var(--line);
}

.plan-server-row span {
  word-break: break-word;
}

@media (max-width: 680px) {
  .plan-server-table {
    overflow-x: auto;
  }

  .plan-server-head,
  .plan-server-row {
    min-width: 620px;
  }
}
</style>
