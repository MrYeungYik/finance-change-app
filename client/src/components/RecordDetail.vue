<script setup>
import { computed } from 'vue';
import { formatDateDot, formatDateTime } from '../utils/format';

const props = defineProps({
  record: { type: Object, required: true },
});

const form = computed(() => props.record.formData || {});
const databaseChoices = ['表结构', '索引', '触发器', '存储过程'];
const networkChoices = ['网络', '资源'];

function selected(list, value) {
  return Array.isArray(list) && list.includes(value);
}
</script>

<template>
  <div class="record-detail">
    <div class="detail-hero">
      <p class="eyebrow">RECORD #{{ String(record.id).padStart(4, '0') }}</p>
      <h3>{{ record.fileName }}</h3>
      <p>导出时间：{{ formatDateTime(record.exportedAt) }} · 申请日期：{{ formatDateDot(form.applicationDate) }}</p>
    </div>

    <section class="detail-section">
      <h4 class="detail-section-title">基础信息</h4>
      <dl class="detail-grid">
        <div class="detail-field">
          <dt>变更申请人</dt>
          <dd>{{ form.applicant || '—' }}</dd>
        </div>
        <div class="detail-field">
          <dt>申请部门</dt>
          <dd>{{ form.department || '—' }}</dd>
        </div>
        <div class="detail-field">
          <dt>申请日期</dt>
          <dd>{{ formatDateDot(form.applicationDate) }}</dd>
        </div>
        <div class="detail-field">
          <dt>期望变更日期</dt>
          <dd>{{ formatDateDot(form.expectedChangeDate) }}</dd>
        </div>
        <div class="detail-field">
          <dt>开发负责人 A</dt>
          <dd>{{ form.devOwnerA || '—' }}</dd>
        </div>
        <div class="detail-field">
          <dt>开发负责人 B</dt>
          <dd>{{ form.devOwnerB || '—' }}</dd>
        </div>
        <div class="detail-field">
          <dt>变更系统</dt>
          <dd>{{ form.changeSystem || '—' }}</dd>
        </div>
        <div class="detail-field">
          <dt>是否需要报备</dt>
          <dd>{{ form.needsReport || '—' }}</dd>
        </div>
      </dl>
    </section>

    <section class="detail-section">
      <h4 class="detail-section-title">变更功能点</h4>
      <div v-if="form.changeItems?.length" class="detail-items">
        <div class="detail-items-head">
          <span>编号</span><span>变更类别</span><span>功能点名称</span>
        </div>
        <div v-for="(item, index) in form.changeItems" :key="index" class="detail-items-row">
          <span>{{ String(index + 1).padStart(2, '0') }}</span>
          <span>{{ item.category }}</span>
          <span>{{ item.featureName }}</span>
        </div>
      </div>
      <p v-else class="detail-empty">未填写变更功能点</p>
    </section>

    <section class="detail-section">
      <h4 class="detail-section-title">影响范围与风险</h4>
      <dl class="detail-grid">
        <div class="detail-field full">
          <dt>风险说明</dt>
          <dd>{{ form.riskDescription || '—' }}</dd>
        </div>
        <div class="detail-field">
          <dt>关联变更</dt>
          <dd>{{ form.relatedChange || '—' }}</dd>
        </div>
        <div class="detail-field">
          <dt>关联系统</dt>
          <dd>{{ form.relatedChange === '是' ? form.relatedSystems || '—' : '不涉及' }}</dd>
        </div>
        <div class="detail-field full">
          <dt>数据库</dt>
          <dd class="read-choices">
            <span
              v-for="option in databaseChoices"
              :key="option"
              class="read-choice"
              :class="{ on: selected(form.databaseChanges, option) }"
            >
              {{ selected(form.databaseChanges, option) ? '●' : '○' }} {{ option }}
            </span>
          </dd>
        </div>
        <div class="detail-field full">
          <dt>网络与资源</dt>
          <dd class="read-choices">
            <span
              v-for="option in networkChoices"
              :key="option"
              class="read-choice"
              :class="{ on: selected(form.networkChanges, option) }"
            >
              {{ selected(form.networkChanges, option) ? '●' : '○' }} {{ option }}
            </span>
          </dd>
        </div>
        <div class="detail-field">
          <dt>网络变更时间</dt>
          <dd>{{ selected(form.networkChanges, '网络') ? formatDateDot(form.networkChangeTime) : '不涉及' }}</dd>
        </div>
        <div class="detail-field">
          <dt>资源变更时间</dt>
          <dd>{{ selected(form.networkChanges, '资源') ? formatDateDot(form.resourceChangeTime) : '不涉及' }}</dd>
        </div>
      </dl>
    </section>

    <section class="detail-section">
      <h4 class="detail-section-title">实施与回退</h4>
      <dl class="detail-grid">
        <div class="detail-field full">
          <dt>变更实施方案</dt>
          <dd>{{ form.implementationPlan || '—' }}</dd>
        </div>
        <div class="detail-field full">
          <dt>备份回退方案</dt>
          <dd>{{ form.rollbackPlan || '—' }}</dd>
        </div>
      </dl>
    </section>

    <section class="detail-section">
      <h4 class="detail-section-title">验证与值守</h4>
      <dl class="detail-grid">
        <div class="detail-field">
          <dt>变更验证人 1</dt>
          <dd>{{ form.verifier1 || '—' }}</dd>
        </div>
        <div class="detail-field">
          <dt>联系方式</dt>
          <dd>{{ form.verifierContact || '—' }}</dd>
        </div>
        <div class="detail-field">
          <dt>次日值守人员</dt>
          <dd>{{ form.nextDayDuty || '—' }}</dd>
        </div>
        <div class="detail-field">
          <dt>联系方式</dt>
          <dd>{{ form.dutyContact || '—' }}</dd>
        </div>
        <div class="detail-field full">
          <dt>变更验证方案</dt>
          <dd>{{ form.verificationPlan || '—' }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.read-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
}

.read-choice {
  color: var(--ink-400);
  font-size: 12px;
  white-space: nowrap;
}

.read-choice.on {
  color: var(--accent-dark);
  font-weight: 500;
}
</style>
