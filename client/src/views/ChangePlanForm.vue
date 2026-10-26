<script setup>
// 编辑变更方案：从申请表带入变更需求/变更系统，按彩色 Word 模板填写手工项与多选项。
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  CircleCheckFilled,
  Delete,
  DocumentAdd,
  Download,
  InfoFilled,
  Plus,
  Tickets,
} from '@element-plus/icons-vue';
import PageHero from '../components/PageHero.vue';
import FieldLabel from '../components/FieldLabel.vue';
import StepTable from '../components/StepTable.vue';
import { api, downloadBlob, filenameFromDisposition, getErrorMessage } from '../api';
import { dateToDot, formatDateTime, padNumber } from '../utils/format';

const route = useRoute();
const router = useRouter();
const formRef = ref();
const loading = ref(true);
const loadError = ref('');
const exporting = ref(false);
const schema = ref(null);
const changeMethodOptions = ref([]);
const planOptions = ref({ assets: [], ips: [] });
const templates = ref([]);
const templateDialogVisible = ref(false);
const applyingTemplateId = ref(null);
const editingRecordId = ref(null);
const editingFileName = ref('');
const lastExport = ref(null);

let rowKeySeed = 0;

function makeServerRow(source = {}) {
  let ips = [];
  if (Array.isArray(source.ips)) {
    ips = source.ips.filter((value) => typeof value === 'string');
  } else if (typeof source.ip === 'string') {
    ips = source.ip.split(/[、,，;；\n]/).map((value) => value.trim());
  }
  return {
    _key: ++rowKeySeed,
    assetName: source.assetName || '',
    ips: [...new Set(ips.filter(Boolean))],
    username: source.username || '',
    assetType: source.assetType || '',
  };
}

function emptyStepRows(source = {}) {
  const rows = {};
  for (const table of schema.value?.stepTables || []) {
    const values = Array.isArray(source[table.key])
      ? source[table.key].filter((value) => typeof value === 'string')
      : [];
    rows[table.key] = values.length ? [...values] : [''];
  }
  return rows;
}

function emptyManual() {
  const manual = {};
  for (const field of schema.value?.manualFields || []) {
    manual[field.key] = '';
  }
  return manual;
}

const form = reactive({
  requirementText: '',
  changeSystem: '',
  expectedChangeDate: '',
  changeMethod: '',
  verificationPlan: '',
  manual: {},
  stepRows: {},
  serverRows: [],
  dbChanges: [],
  autoDeployChanges: [],
  configFileChanges: [],
  sourceApplicationRecordId: null,
  templateId: null,
});

const isReedit = computed(() => Boolean(editingRecordId.value));
const requirementOptions = computed(() => {
  const seen = new Set();
  return String(form.requirementText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
});

function uniqueAssetValues(kind) {
  const values = planOptions.value.assets
    .filter((option) => option.systemName === form.changeSystem && option.kind === kind)
    .map((option) => option.value);
  return [...new Set(values)];
}

const assetNameOptions = computed(() => uniqueAssetValues('assetName'));
const assetTypeOptions = computed(() => uniqueAssetValues('assetType'));

function ipOptionsFor(assetName) {
  if (!assetName) return [];
  const values = planOptions.value.ips
    .filter((option) => option.assetName === assetName)
    .map((option) => option.value);
  return [...new Set(values)];
}

/** 历史记录中的旧值可能已不在维护列表中，仍作为可选项展示，避免重新编辑时丢失。 */
function withCurrentOption(options, current) {
  const value = String(current || '').trim();
  if (!value || options.includes(value)) return options;
  return [value, ...options];
}

function ipOptionsForRow(row) {
  return [...new Set([...ipOptionsFor(row.assetName), ...(row.ips || [])])];
}

function handleAssetNameChange(row) {
  const allowed = new Set(ipOptionsFor(row.assetName));
  row.ips = row.ips.filter((ip) => allowed.has(ip));
  formRef.value?.clearValidate('serverRows');
}

function fieldsFor(section) {
  return (schema.value?.manualFields || []).filter((field) => field.section === section);
}

function stepFor(section) {
  return (schema.value?.stepTables || []).find((table) => table.section === section);
}

function stepRules(table) {
  return [{
    validator: (rule, value, callback) => {
      if (Array.isArray(value) && value.some((text) => String(text || '').trim())) {
        callback();
        return;
      }
      callback(new Error(`请至少填写一条${table.label}`));
    },
    trigger: 'change',
  }];
}

function manualRules(field) {
  return [{ required: true, message: `请填写${field.label}`, trigger: 'blur' }];
}

function serverPlaceholder(index, key) {
  const samples = schema.value?.serverTable?.sampleRows || [];
  const sample = samples[index] || samples[0] || {};
  return sample[key] || '';
}

function rowFilledCount(row) {
  return [
    String(row.assetName || '').trim(),
    Array.isArray(row.ips) && row.ips.length ? 'ip' : '',
    String(row.username || '').trim(),
    String(row.assetType || '').trim(),
  ].filter(Boolean).length;
}

function validateServerRows(rule, value, callback) {
  if (!Array.isArray(value)) {
    callback(new Error('服务器信息格式不正确'));
    return;
  }
  const incomplete = value.findIndex((row) => {
    const filled = rowFilledCount(row);
    return filled > 0 && filled < 4;
  });
  if (incomplete >= 0) {
    callback(new Error(`第 ${incomplete + 1} 行需完整填写资产名称、IP 地址（至少一个）、用户名、资产类型`));
    return;
  }
  if (!value.some((row) => rowFilledCount(row) === 4)) {
    callback(new Error('请至少填写一条完整的服务器信息'));
    return;
  }
  callback();
}

const rules = {
  requirementText: [{ required: true, message: '变更需求不能为空', trigger: 'blur' }],
  changeSystem: [{ required: true, message: '变更系统不能为空', trigger: 'blur' }],
  expectedChangeDate: [{ required: true, message: '请选择期望变更日期', trigger: 'change' }],
  changeMethod: [{ required: true, message: '请选择变更方式', trigger: 'change' }],
  serverRows: [{ validator: validateServerRows, trigger: 'change' }],
};

async function loadTemplates() {
  try {
    const { data } = await api.get('/plans/templates');
    templates.value = data.templates || [];
  } catch {
    templates.value = [];
  }
}

function fillFromPlanData(data = {}, record = {}) {
  form.requirementText = data.requirementText || '';
  form.changeSystem = data.changeSystem || record.changeSystem || '';
  form.expectedChangeDate = data.expectedChangeDate || record.expectedChangeDate || '';
  form.changeMethod = data.changeMethod || '自动化+手工部署';
  form.verificationPlan = data.verificationPlan || '';

  form.manual = emptyManual();
  for (const field of schema.value.manualFields) {
    const value = data.manual && typeof data.manual[field.key] === 'string'
      ? data.manual[field.key]
      : '';
    form.manual[field.key] = value;
  }

  form.stepRows = emptyStepRows(data.stepRows || {});

  const rows = Array.isArray(data.serverRows) ? data.serverRows.map(makeServerRow) : [];
  form.serverRows = rows.length ? rows : [makeServerRow()];

  form.dbChanges = Array.isArray(data.dbChanges) ? [...data.dbChanges] : [];
  form.autoDeployChanges = Array.isArray(data.autoDeployChanges)
    ? [...data.autoDeployChanges]
    : [];
  form.configFileChanges = Array.isArray(data.configFileChanges)
    ? [...data.configFileChanges]
    : [];
  form.sourceApplicationRecordId = record.sourceApplicationRecordId || null;
  form.templateId = record.templateId || null;
}

function fillFromSession(context = {}) {
  const featureNames = Array.isArray(context.featureNames) ? context.featureNames : [];
  form.requirementText = featureNames.join('\n');
  form.changeSystem = context.changeSystem || '';
  form.expectedChangeDate = context.expectedChangeDate || '';
  form.changeMethod = '自动化+手工部署';
  form.verificationPlan = context.verificationPlan || '';
  form.manual = emptyManual();
  form.stepRows = emptyStepRows();
  form.serverRows = [makeServerRow(), makeServerRow(), makeServerRow()];
  form.dbChanges = [];
  form.autoDeployChanges = [];
  form.configFileChanges = [];
  form.sourceApplicationRecordId = context.sourceApplicationRecordId || null;
  form.templateId = null;
}

async function loadInitialData() {
  loading.value = true;
  loadError.value = '';
  formRef.value?.clearValidate();

  const recordId = Number(route.query.record);
  const sessionId = typeof route.query.session === 'string' ? route.query.session : '';

  try {
    const initResponse = await api.get('/plans/init');
    schema.value = initResponse.data.schema;
    changeMethodOptions.value = initResponse.data.changeMethodOptions || [];
    planOptions.value = initResponse.data.planOptions || { assets: [], ips: [] };
    templates.value = initResponse.data.templates || [];

    if (Number.isInteger(recordId) && recordId > 0) {
      const { data } = await api.get(`/plans/${recordId}`);
      editingRecordId.value = recordId;
      editingFileName.value = data.record.fileName;
      fillFromPlanData(data.record.planData, data.record);
    } else if (sessionId) {
      const { data } = await api.get(`/plans/session/${sessionId}`);
      fillFromSession(data.session.context);
      if (templates.value.length) {
        templateDialogVisible.value = true;
      }
    } else {
      throw new Error('缺少变更方案上下文，请从变更申请表页面点击“编辑变更方案”进入');
    }
  } catch (error) {
    loadError.value = await getErrorMessage(error, '加载变更方案失败');
  } finally {
    loading.value = false;
  }
}

function addServerRow() {
  if (form.serverRows.length >= 200) {
    ElMessage.warning('服务器信息最多支持 200 行');
    return;
  }
  form.serverRows.push(makeServerRow());
}

function removeServerRow(index) {
  form.serverRows.splice(index, 1);
  formRef.value?.clearValidate('serverRows');
}

async function applyTemplate(template) {
  applyingTemplateId.value = template.id;
  try {
    const { data } = await api.get(`/plans/templates/${template.id}`);
    const planData = data.template.planData || {};

    for (const field of schema.value.manualFields) {
      if (planData.manual && Object.prototype.hasOwnProperty.call(planData.manual, field.key)) {
        form.manual[field.key] = planData.manual[field.key] || '';
      }
    }
    form.stepRows = emptyStepRows(planData.stepRows || {});
    if (Array.isArray(planData.serverRows) && planData.serverRows.length) {
      form.serverRows = planData.serverRows.map(makeServerRow);
    }
    // 自动字段与下拉字段不套用模板值，保留当前申请表带入的内容。
    form.templateId = template.id;
    templateDialogVisible.value = false;
    ElMessage.success(`已加载模板：${template.name}`);
  } catch (error) {
    ElMessage.error(await getErrorMessage(error, '加载模板失败'));
  } finally {
    applyingTemplateId.value = null;
  }
}

async function removeTemplate(template) {
  try {
    await ElMessageBox.confirm(
      `确定删除模板“${template.name}”？已导出的方案记录不受影响。`,
      '删除模板',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      },
    );
    await api.delete(`/plans/templates/${template.id}`);
    if (form.templateId === template.id) form.templateId = null;
    await loadTemplates();
    ElMessage.success('模板已删除');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(await getErrorMessage(error, '删除模板失败'));
    }
  }
}

function handleExport() {
  if (loading.value || loadError.value) return;
  formRef.value?.validate(async (valid, fields) => {
    if (!valid) {
      const firstField = Object.keys(fields || {})[0];
      if (firstField) formRef.value?.scrollToField(firstField);
      ElMessage.warning('请先完善表单中标记为必填的内容');
      return;
    }

    exporting.value = true;
    try {
      const payload = {
        requirementText: form.requirementText,
        changeSystem: form.changeSystem,
        expectedChangeDate: form.expectedChangeDate,
        changeMethod: form.changeMethod,
        verificationPlan: form.verificationPlan,
        manual: { ...form.manual },
        stepRows: Object.fromEntries(
          (schema.value?.stepTables || []).map((table) => [
            table.key,
            (form.stepRows[table.key] || [])
              .map((text) => String(text || '').trim())
              .filter(Boolean),
          ]),
        ),
        serverRows: form.serverRows.map(({ _key, ...row }) => ({
          ...row,
          ips: [...row.ips],
        })),
        dbChanges: form.dbChanges,
        autoDeployChanges: form.autoDeployChanges,
        configFileChanges: form.configFileChanges,
        sourceRecordId: editingRecordId.value || null,
        sourceApplicationRecordId: form.sourceApplicationRecordId || null,
        templateId: form.templateId || null,
      };

      const response = await api.post('/plans', payload, { responseType: 'blob' });
      const recordId = response.headers['x-record-id'];
      const fallbackName = `${form.changeSystem}+${dateToDot(
        form.expectedChangeDate,
      )}+变更方案.docx`;
      const fileName = filenameFromDisposition(
        response.headers['content-disposition'],
        fallbackName,
      );

      downloadBlob(response.data, fileName);
      lastExport.value = { id: recordId || null, fileName };
      ElMessage.success(
        recordId ? `导出成功，已生成方案记录 #${recordId}` : '变更方案导出成功',
      );
    } catch (error) {
      ElMessage.error(await getErrorMessage(error, '导出变更方案失败，请稍后重试'));
    } finally {
      exporting.value = false;
    }
  });
}

async function saveAsTemplate(recordId) {
  if (!recordId) return;
  try {
    const { value } = await ElMessageBox.prompt('请输入模板名称', '设为模板', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: `${form.changeSystem || '变更方案'}模板`,
      inputPattern: /\S+/,
      inputErrorMessage: '模板名称不能为空',
    });
    await api.post(`/plans/${recordId}/template`, { name: value.trim() });
    await loadTemplates();
    ElMessage.success('已保存为模板');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(await getErrorMessage(error, '保存模板失败'));
    }
  }
}

watch(
  () => form.requirementText,
  () => {
    const options = requirementOptions.value;
    for (const key of ['dbChanges', 'autoDeployChanges', 'configFileChanges']) {
      form[key] = form[key].filter((value) => options.includes(value));
    }
  },
);

onMounted(loadInitialData);
</script>

<template>
  <div class="page plan-form-page">
    <PageHero
      eyebrow="CHANGE PLAN · IMPLEMENTATION"
      title="编辑变更方案"
      description="变更需求与变更系统自动取自变更申请表；按模板填写实施步骤、服务器信息和回退方案后导出正式 Word。"
    >
      <el-button
        v-if="!isReedit && templates.length"
        :disabled="loading || !!loadError"
        @click="templateDialogVisible = true"
      >
        <el-icon><DocumentAdd /></el-icon>
        选择模板
      </el-button>
      <el-button :disabled="loading || !!loadError" @click="router.push({ name: 'plan-records' })">
        <el-icon><Tickets /></el-icon>
        变更方案记录
      </el-button>
      <el-button
        type="primary"
        :loading="exporting"
        :disabled="loading || !!loadError"
        @click="handleExport"
      >
        <el-icon v-if="!exporting"><Download /></el-icon>
        导出变更方案
      </el-button>
    </PageHero>

    <div v-if="loadError" class="paper-card error-shell">
      <div class="error-inner">
        <h2>变更方案加载失败</h2>
        <p>{{ loadError }}</p>
        <div class="plan-error-actions">
          <el-button type="primary" @click="loadInitialData">重新加载</el-button>
          <el-button @click="router.push({ name: 'form' })">返回填写申请表</el-button>
        </div>
      </div>
    </div>

    <div v-else-if="loading" class="paper-card loading-shell">
      <div class="loading-inner">
        <span class="loading-spinner" aria-hidden="true"></span>
        <p>正在读取变更方案模板与申请表内容…</p>
      </div>
    </div>

    <template v-else>
      <div v-if="isReedit" class="context-banner">
        <el-icon><InfoFilled /></el-icon>
        <div>
          <strong>正在重新编辑变更方案记录 #{{ String(editingRecordId).padStart(4, '0') }}</strong>
          <span v-if="editingFileName"> · {{ editingFileName }}</span>
          <br />
          本次导出会生成一条新记录，原记录不会被覆盖。
        </div>
        <router-link :to="{ name: 'plan-records' }">返回记录</router-link>
      </div>

      <div v-if="lastExport" class="export-success plan-export-success">
        <el-icon><CircleCheckFilled /></el-icon>
        <span>
          导出成功，{{ lastExport.fileName }}
          <template v-if="lastExport.id"> · 留痕记录 #{{ lastExport.id }}</template>
        </span>
        <el-button v-if="lastExport.id" link type="primary" @click="saveAsTemplate(lastExport.id)">
          设为模板
        </el-button>
        <router-link :to="{ name: 'plan-records' }">查看方案记录</router-link>
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        class="change-form plan-form"
        @submit.prevent="handleExport"
      >
        <section class="paper-card">
          <div class="section-head">
            <span class="section-index">01</span>
            <div class="section-heading">
              <h2>基础信息</h2>
              <p>变更需求、变更系统取自申请表；变更方式请手动选择。</p>
            </div>
          </div>
          <div class="section-body">
            <div class="form-grid">
              <el-form-item class="col-12" prop="requirementText">
                <template #label>
                  <FieldLabel
                    text="变更需求"
                    hint="自动取自申请表变更内容，每行一个功能点"
                  />
                </template>
                <el-input
                  v-model="form.requirementText"
                  type="textarea"
                  :rows="4"
                  :readonly="!isReedit"
                  maxlength="10000"
                  placeholder="从变更申请表带入"
                />
              </el-form-item>

              <el-form-item class="col-6" prop="changeSystem">
                <template #label><FieldLabel text="变更系统" /></template>
                <el-input
                  v-model="form.changeSystem"
                  :readonly="!isReedit"
                  maxlength="160"
                  placeholder="从变更申请表带入"
                />
              </el-form-item>

              <el-form-item class="col-3" prop="expectedChangeDate">
                <template #label><FieldLabel text="期望变更日期" /></template>
                <el-date-picker
                  v-model="form.expectedChangeDate"
                  type="date"
                  value-format="YYYY-MM-DD"
                  format="YYYY.MM.DD"
                  :disabled="!isReedit"
                  placeholder="从变更申请表带入"
                />
              </el-form-item>

              <el-form-item class="col-3" prop="changeMethod">
                <template #label><FieldLabel text="变更方式" type="select" /></template>
                <el-select v-model="form.changeMethod" placeholder="请选择变更方式">
                  <el-option
                    v-for="option in changeMethodOptions"
                    :key="option"
                    :label="option"
                    :value="option"
                  />
                </el-select>
              </el-form-item>
            </div>
          </div>
        </section>

        <section class="paper-card">
          <div class="section-head">
            <span class="section-index">02</span>
            <div class="section-heading">
              <h2>变更文件清单</h2>
              <p>填写本次上线的变更包名称及包内容说明。</p>
            </div>
          </div>
          <div class="section-body">
            <div class="form-grid">
              <el-form-item
                v-for="field in fieldsFor('变更文件清单')"
                :key="field.key"
                :class="field.kind === 'input' ? 'col-6' : 'col-12'"
                :prop="`manual.${field.key}`"
                :rules="manualRules(field)"
              >
                <template #label><FieldLabel :text="field.label" type="manual" /></template>
                <el-input
                  v-model="form.manual[field.key]"
                  :type="field.kind === 'textarea' ? 'textarea' : 'text'"
                  :rows="field.kind === 'textarea' ? 3 : undefined"
                  :placeholder="field.placeholder"
                  :maxlength="field.kind === 'input' ? 500 : 5000"
                />
              </el-form-item>
            </div>
          </div>
        </section>

        <section class="paper-card">
          <div class="section-head">
            <span class="section-index">03</span>
            <div class="section-heading">
              <h2>变更操作服务器和用户</h2>
              <p>
                资产名称与资产类型按当前变更系统联动，IP 地址按行内资产名称联动；
                <router-link :to="{ name: 'asset-options' }">前往资产选项维护</router-link>
              </p>
            </div>
            <div class="section-head-actions">
              <el-button type="primary" plain size="small" @click="addServerRow">
                <el-icon><Plus /></el-icon>
                新增服务器
              </el-button>
            </div>
          </div>
          <div class="section-body">
            <el-form-item prop="serverRows" class="items-form-item plan-server-form-item">
              <div class="server-table-wrap">
                <div class="items-table server-table">
                  <div class="items-head">
                    <span>编号</span>
                    <span><i class="field-marker select"></i>资产名称</span>
                    <span><i class="field-marker select"></i>IP 地址</span>
                    <span><i class="field-marker manual"></i>用户名</span>
                    <span><i class="field-marker select"></i>资产类型</span>
                    <span>操作</span>
                  </div>
                  <div v-if="!form.serverRows.length" class="items-empty">
                    暂无服务器信息，请点击“新增服务器”。
                  </div>
                  <div v-for="(row, index) in form.serverRows" :key="row._key" class="items-row">
                    <span class="item-seq">{{ padNumber(index + 1) }}</span>
                    <el-select
                      v-model="row.assetName"
                      filterable
                      clearable
                      :placeholder="assetNameOptions.length ? '选择资产名称' : '暂无资产名称，请先维护'"
                      @change="handleAssetNameChange(row)"
                    >
                      <el-option
                        v-for="option in withCurrentOption(assetNameOptions, row.assetName)"
                        :key="option"
                        :label="option"
                        :value="option"
                      />
                    </el-select>
                    <el-select
                      v-model="row.ips"
                      multiple
                      filterable
                      collapse-tags
                      collapse-tags-tooltip
                      :disabled="!row.assetName"
                      :placeholder="
                        row.assetName
                          ? (ipOptionsForRow(row).length ? '选择 IP 地址' : '该资产暂无 IP 选项')
                          : '请先选择资产名称'
                      "
                    >
                      <el-option
                        v-for="option in ipOptionsForRow(row)"
                        :key="option"
                        :label="option"
                        :value="option"
                      >
                        <span class="select-check-option">
                          <el-checkbox :model-value="row.ips.includes(option)" />
                          <span class="select-check-label">{{ option }}</span>
                        </span>
                      </el-option>
                    </el-select>
                    <el-input
                      v-model="row.username"
                      :placeholder="serverPlaceholder(index, 'username')"
                      maxlength="500"
                    />
                    <el-select
                      v-model="row.assetType"
                      filterable
                      clearable
                      :placeholder="assetTypeOptions.length ? '选择资产类型' : '暂无资产类型，请先维护'"
                    >
                      <el-option
                        v-for="option in withCurrentOption(assetTypeOptions, row.assetType)"
                        :key="option"
                        :label="option"
                        :value="option"
                      />
                    </el-select>
                    <el-button
                      class="item-delete"
                      text
                      :icon="Delete"
                      aria-label="删除该行"
                      @click="removeServerRow(index)"
                    />
                  </div>
                </div>
              </div>
            </el-form-item>
            <el-button class="add-item-btn" @click="addServerRow">
              <el-icon><Plus /></el-icon>
              新增一行
            </el-button>
          </div>
        </section>

        <section class="paper-card">
          <div class="section-head">
            <span class="section-index">04</span>
            <div class="section-heading">
              <h2>变更操作步骤</h2>
              <p>选择每类操作对应的变更需求，并填写具体执行步骤。</p>
            </div>
          </div>
          <div class="section-body">
            <h3 class="plan-subhead">（一）数据库变更</h3>
            <div class="form-grid">
              <el-form-item class="col-12" prop="dbChanges">
                <template #label>
                  <FieldLabel text="关联变更需求" type="select" hint="可多选、可为空，导出时以顿号连接" />
                </template>
                <el-select
                  v-model="form.dbChanges"
                  multiple
                  filterable
                  collapse-tags
                  collapse-tags-tooltip
                  placeholder="请选择数据库变更对应的需求"
                >
                  <el-option
                    v-for="option in requirementOptions"
                    :key="option"
                    :label="option"
                    :value="option"
                  />
                </el-select>
              </el-form-item>

              <el-form-item
                v-if="stepFor('数据库变更')"
                class="col-12 plan-step-form-item"
                :prop="'stepRows.' + stepFor('数据库变更').key"
                :rules="stepRules(stepFor('数据库变更'))"
              >
                <template #label>
                  <FieldLabel :text="stepFor('数据库变更').label" type="manual" hint="逐行填写，序号自动生成" />
                </template>
                <StepTable
                  v-model="form.stepRows[stepFor('数据库变更').key]"
                  :placeholder="stepFor('数据库变更').placeholder"
                  @change="formRef?.clearValidate('stepRows.' + stepFor('数据库变更').key)"
                />
              </el-form-item>
            </div>

            <h3 class="plan-subhead">（二）自动化部署</h3>
            <div class="form-grid">
              <el-form-item class="col-12" prop="autoDeployChanges">
                <template #label>
                  <FieldLabel text="关联变更需求" type="select" hint="可多选、可为空，导出时以顿号连接" />
                </template>
                <el-select
                  v-model="form.autoDeployChanges"
                  multiple
                  filterable
                  collapse-tags
                  collapse-tags-tooltip
                  placeholder="请选择自动化部署对应的需求"
                >
                  <el-option
                    v-for="option in requirementOptions"
                    :key="option"
                    :label="option"
                    :value="option"
                  />
                </el-select>
              </el-form-item>
              <div class="col-12 plan-fixed-note">
                自动化部署的具体流程和检查项为模板固定内容，无需填写；自动化部署失败时执行下方手工变更。
              </div>
            </div>

            <h3 class="plan-subhead">（三）修改配置文件</h3>
            <div class="form-grid">
              <el-form-item class="col-12" prop="configFileChanges">
                <template #label>
                  <FieldLabel text="关联变更需求" type="select" hint="可多选、可为空，导出时以顿号连接" />
                </template>
                <el-select
                  v-model="form.configFileChanges"
                  multiple
                  filterable
                  collapse-tags
                  collapse-tags-tooltip
                  placeholder="请选择配置文件变更对应的需求"
                >
                  <el-option
                    v-for="option in requirementOptions"
                    :key="option"
                    :label="option"
                    :value="option"
                  />
                </el-select>
              </el-form-item>

              <el-form-item
                v-if="stepFor('修改配置文件')"
                class="col-12 plan-step-form-item"
                :prop="'stepRows.' + stepFor('修改配置文件').key"
                :rules="stepRules(stepFor('修改配置文件'))"
              >
                <template #label>
                  <FieldLabel :text="stepFor('修改配置文件').label" type="manual" hint="逐行填写，序号自动生成" />
                </template>
                <StepTable
                  v-model="form.stepRows[stepFor('修改配置文件').key]"
                  :placeholder="stepFor('修改配置文件').placeholder"
                  @change="formRef?.clearValidate('stepRows.' + stepFor('修改配置文件').key)"
                />
              </el-form-item>
            </div>

            <h3 class="plan-subhead">（四）手工变更</h3>
            <div class="form-grid">
              <el-form-item
                v-if="stepFor('手工变更')"
                class="col-12 plan-step-form-item"
                :prop="'stepRows.' + stepFor('手工变更').key"
                :rules="stepRules(stepFor('手工变更'))"
              >
                <template #label>
                  <FieldLabel :text="stepFor('手工变更').label" type="manual" hint="逐行填写，序号自动生成" />
                </template>
                <StepTable
                  v-model="form.stepRows[stepFor('手工变更').key]"
                  :placeholder="stepFor('手工变更').placeholder"
                  @change="formRef?.clearValidate('stepRows.' + stepFor('手工变更').key)"
                />
              </el-form-item>
            </div>
          </div>
        </section>

        <section class="paper-card">
          <div class="section-head">
            <span class="section-index">05</span>
            <div class="section-heading">
              <h2>变更回退方案</h2>
              <p>填写应用回退与数据库回退的具体步骤。</p>
            </div>
          </div>
          <div class="section-body">
            <h3 class="plan-subhead">（一）应用回退</h3>
            <div class="form-grid">
              <el-form-item
                v-if="stepFor('应用回退')"
                class="col-12 plan-step-form-item"
                :prop="'stepRows.' + stepFor('应用回退').key"
                :rules="stepRules(stepFor('应用回退'))"
              >
                <template #label>
                  <FieldLabel :text="stepFor('应用回退').label" type="manual" hint="逐行填写，序号自动生成" />
                </template>
                <StepTable
                  v-model="form.stepRows[stepFor('应用回退').key]"
                  :placeholder="stepFor('应用回退').placeholder"
                  @change="formRef?.clearValidate('stepRows.' + stepFor('应用回退').key)"
                />
              </el-form-item>
            </div>

            <h3 class="plan-subhead">（二）数据库回退</h3>
            <div class="form-grid">
              <el-form-item
                v-if="stepFor('数据库回退')"
                class="col-12 plan-step-form-item"
                :prop="'stepRows.' + stepFor('数据库回退').key"
                :rules="stepRules(stepFor('数据库回退'))"
              >
                <template #label>
                  <FieldLabel :text="stepFor('数据库回退').label" type="manual" hint="逐行填写，序号自动生成" />
                </template>
                <StepTable
                  v-model="form.stepRows[stepFor('数据库回退').key]"
                  :placeholder="stepFor('数据库回退').placeholder"
                  @change="formRef?.clearValidate('stepRows.' + stepFor('数据库回退').key)"
                />
              </el-form-item>
            </div>
          </div>
        </section>

        <section class="paper-card">
          <div class="section-head">
            <span class="section-index">06</span>
            <div class="section-heading">
              <h2>变更验证方案</h2>
              <p>自动取自变更申请表的变更验证方案；重新编辑时可修改。</p>
            </div>
          </div>
          <div class="section-body">
            <div class="form-grid">
              <el-form-item class="col-12" prop="verificationPlan">
                <template #label>
                  <FieldLabel
                    :text="schema?.verificationField?.label || '变更验证方案'"
                    hint="自动取自变更申请表"
                  />
                </template>
                <el-input
                  v-model="form.verificationPlan"
                  type="textarea"
                  :rows="4"
                  :readonly="!isReedit"
                  maxlength="10000"
                  :placeholder="schema?.verificationField?.placeholder || '从变更申请表带入'"
                />
              </el-form-item>
            </div>
          </div>
        </section>

        <section v-if="schema?.fixedSections?.length" class="paper-card">
          <div class="section-head">
            <span class="section-index">07</span>
            <div class="section-heading">
              <h2>固定内容说明</h2>
              <p>以下内容由模板固定带入，无需在页面填写。</p>
            </div>
          </div>
          <div class="section-body fixed-section-body">
            <div v-for="section in schema.fixedSections" :key="section.title" class="plan-fixed-note">
              <strong>{{ section.title }}</strong>
              <p v-for="line in section.lines" :key="line">{{ line }}</p>
            </div>
          </div>
        </section>
      </el-form>

      <div class="form-footer">
        <div class="form-footer-note">
          <el-icon><InfoFilled /></el-icon>
          <span>导出后将在浏览器下载 Word 文件，同时自动保存本次变更方案留痕。</span>
        </div>
        <div class="form-footer-actions">
          <el-button @click="router.push({ name: 'plan-records' })">变更方案记录</el-button>
          <el-button type="primary" :loading="exporting" @click="handleExport">
            <el-icon v-if="!exporting"><Download /></el-icon>
            导出变更方案
          </el-button>
        </div>
      </div>
    </template>

    <el-dialog
      v-model="templateDialogVisible"
      title="选择变更方案模板"
      width="min(680px, 92vw)"
      destroy-on-close
    >
      <div v-if="!templates.length" class="template-empty">
        暂无可用模板。完成一次方案导出后，可在成功提示或方案记录中点击“设为模板”。
      </div>
      <div v-else class="template-list">
        <div v-for="template in templates" :key="template.id" class="template-item">
          <div class="template-copy">
            <strong>{{ template.name }}</strong>
            <small>
              更新于 {{ formatDateTime(template.updatedAt) }}
              <span v-if="template.sourcePlanRecordId">
                · 来源记录 #{{ String(template.sourcePlanRecordId).padStart(4, '0') }}
              </span>
            </small>
          </div>
          <div class="template-actions">
            <el-button
              type="primary"
              plain
              size="small"
              :loading="applyingTemplateId === template.id"
              @click="applyTemplate(template)"
            >
              使用此模板
            </el-button>
            <el-button text type="danger" size="small" @click="removeTemplate(template)">
              删除
            </el-button>
          </div>
        </div>
      </div>
      <template #footer>
        <span class="template-hint">套用模板只填充手工项和服务器表，不覆盖自动字段与下拉选项。</span>
        <el-button @click="templateDialogVisible = false">暂不使用模板</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.plan-form-page {
  --form-accent: var(--accent);
}

.plan-form-page .paper-card {
  overflow: hidden;
}

.plan-form :deep(.el-form-item__content) {
  min-width: 0;
}

.plan-form :deep(.el-select),
.plan-form :deep(.el-date-editor) {
  width: 100%;
}

.plan-subhead {
  margin: 22px 0 10px;
  padding-left: 10px;
  border-left: 3px solid var(--accent);
  color: var(--ink-800);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.5;
}

.plan-subhead:first-child {
  margin-top: 0;
}

.plan-fixed-note {
  padding: 12px 14px;
  border: 1px dashed var(--line-strong);
  border-radius: 11px;
  color: var(--ink-600);
  background: var(--paper-soft);
  font-size: 12.5px;
  line-height: 1.75;
}

.plan-fixed-note strong {
  display: block;
  margin-bottom: 4px;
  color: var(--ink-800);
}

.plan-fixed-note p {
  margin: 0;
}

.fixed-section-body {
  display: grid;
  gap: 12px;
}

.server-table-wrap {
  max-width: 100%;
  overflow-x: auto;
}

.server-table {
  min-width: 1040px;
}

.server-table .items-head,
.server-table .items-row {
  grid-template-columns: 52px minmax(160px, 1.2fr) minmax(210px, 1.7fr) minmax(120px, 1fr) minmax(140px, 1fr) 44px;
}

.server-table .items-head span:last-child {
  justify-content: center;
}

.plan-server-form-item,
.plan-step-form-item {
  margin-bottom: 0;
}

.plan-server-form-item :deep(.el-form-item__content),
.plan-step-form-item :deep(.el-form-item__content) {
  display: block;
}

.select-check-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.select-check-option :deep(.el-checkbox) {
  height: auto;
  margin-right: 0;
  pointer-events: none;
}

.select-check-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-list {
  display: grid;
  gap: 10px;
  max-height: 52vh;
  overflow-y: auto;
}

.template-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fffefb;
}

.template-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.template-copy strong {
  color: var(--ink-800);
  font-size: 13.5px;
}

.template-copy small {
  color: var(--ink-500);
  font-size: 11.5px;
}

.template-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
  flex-shrink: 0;
}

.template-hint {
  float: left;
  max-width: 58%;
  color: var(--ink-500);
  font-size: 11.5px;
  line-height: 1.5;
  text-align: left;
}

.template-empty {
  padding: 26px 12px;
  color: var(--ink-500);
  font-size: 12.5px;
  text-align: center;
}

.plan-export-success .el-button {
  margin-left: auto;
}

.plan-export-success a {
  margin-left: 0;
}

.plan-error-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 16px;
}

@media (max-width: 680px) {
  .template-item {
    align-items: flex-start;
    flex-direction: column;
  }

  .template-actions {
    margin-left: 0;
  }

  .template-hint {
    display: block;
    float: none;
    max-width: none;
    margin-bottom: 10px;
  }
}
</style>
