<script setup>
// 填写申请表：初始化服务端数据、必填校验、导出 Word、历史记录回填
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Calendar,
  CircleCheckFilled,
  Delete,
  DocumentAdd,
  Download,
  InfoFilled,
  Plus,
  RefreshLeft,
  Tickets,
} from '@element-plus/icons-vue';
import PageHero from '../components/PageHero.vue';
import FieldLabel from '../components/FieldLabel.vue';
import ChoiceGroup from '../components/ChoiceGroup.vue';
import { api, downloadBlob, filenameFromDisposition, getErrorMessage } from '../api';
import { dateToDot, formatDateDot, padNumber } from '../utils/format';

const route = useRoute();
const router = useRouter();
const formRef = ref();
const loading = ref(true);
const loadError = ref('');
const exporting = ref(false);
const planOpening = ref(false);
const editingRecordId = ref(null);
const editingFileName = ref('');
const lastExport = ref(null);

const groups = reactive({
  department: [],
  system: [],
  changeCategory: [],
});

let itemKeySeed = 0;

function makeItem(source = {}) {
  return {
    _key: ++itemKeySeed,
    category: source.category || '',
    featureName: source.featureName || '',
  };
}

function emptyForm() {
  return {
    applicant: '',
    department: '',
    applicationDate: '',
    devOwnerA: '',
    devOwnerB: '',
    changeSystem: '',
    needsReport: '',
    expectedChangeDate: '',
    changeItems: [],
    riskDescription: '',
    relatedChange: '',
    relatedSystems: '',
    databaseChanges: [],
    ddlDml: '',
    networkChanges: [],
    networkChangeTime: '',
    resourceChangeTime: '',
    implementationPlan: '',
    rollbackPlan: '',
    verifier1: '',
    verifierContact: '',
    nextDayDuty: '',
    dutyContact: '',
    verificationPlan: '',
    sourceRecordId: null,
  };
}

const form = reactive(emptyForm());

function setGroupData(groupData = {}) {
  groups.department = Array.isArray(groupData.department) ? groupData.department : [];
  groups.system = Array.isArray(groupData.system) ? groupData.system : [];
  groups.changeCategory = Array.isArray(groupData.changeCategory)
    ? groupData.changeCategory
    : [];
}

function fillForm(source = {}, serverDate = '') {
  const base = emptyForm();
  Object.assign(form, base, source, {
    applicationDate: serverDate || source.applicationDate || form.applicationDate,
  });
  form.changeItems = (Array.isArray(source.changeItems) ? source.changeItems : []).map((item) =>
    makeItem(item),
  );
  if (!form.changeItems.length) form.changeItems.push(makeItem());
  form.databaseChanges = Array.isArray(source.databaseChanges)
    ? [...source.databaseChanges]
    : [];
  form.networkChanges = Array.isArray(source.networkChanges) ? [...source.networkChanges] : [];
  form.needsReport = source.needsReport || '';
  form.relatedChange = source.relatedChange || '';
  form.sourceRecordId = editingRecordId.value || null;
}

function ensureCurrent(options, current) {
  const values = options.map((option) => option.value);
  if (current && !values.includes(current)) return [current, ...values];
  return values;
}

const departmentOptions = computed(() => ensureCurrent(groups.department, form.department));
const systemOptions = computed(() => ensureCurrent(groups.system, form.changeSystem));
const categoryOptions = computed(() => {
  const values = groups.changeCategory.map((option) => option.value);
  for (const item of form.changeItems) {
    if (item.category && !values.includes(item.category)) values.push(item.category);
  }
  return values;
});

async function loadInitialData() {
  loading.value = true;
  loadError.value = '';
  formRef.value?.clearValidate();
  const recordId = Number(route.query.record);

  try {
    const [initResponse, recordResponse] = await Promise.all([
      api.get('/form/init'),
      Number.isInteger(recordId) && recordId > 0
        ? api.get(`/exports/${recordId}`)
        : Promise.resolve(null),
    ]);

    const init = initResponse.data;
    setGroupData(init.groups);

    if (recordResponse) {
      editingRecordId.value = recordResponse.data.record.id;
      editingFileName.value = recordResponse.data.record.fileName;
      fillForm(recordResponse.data.record.formData, init.applicationDate);
    } else {
      editingRecordId.value = null;
      editingFileName.value = '';
      fillForm(init.defaults, init.applicationDate);
    }
  } catch (error) {
    loadError.value = await getErrorMessage(error, '初始化表单失败');
  } finally {
    loading.value = false;
  }
}

function validateChangeItems(rule, value, callback) {
  if (!Array.isArray(value) || !value.length) {
    callback(new Error('请至少填写一条变更功能点'));
    return;
  }
  const incompleteIndex = value.findIndex((item) => !item.category || !item.featureName);
  if (incompleteIndex >= 0) {
    callback(new Error(`请完整填写第 ${incompleteIndex + 1} 行变更功能点`));
    return;
  }
  callback();
}

function validateRelatedSystems(rule, value, callback) {
  if (form.relatedChange === '是' && !String(value || '').trim()) {
    callback(new Error('涉及关联变更时，请填写关联系统'));
    return;
  }
  callback();
}

function validateNetworkTime(rule, value, callback) {
  if (form.networkChanges.includes('网络') && !value) {
    callback(new Error('请选择网络变更时间'));
    return;
  }
  callback();
}

function validateResourceTime(rule, value, callback) {
  if (form.networkChanges.includes('资源') && !value) {
    callback(new Error('请选择资源变更时间'));
    return;
  }
  callback();
}

const rules = {
  applicant: [{ required: true, message: '请输入变更申请人', trigger: 'blur' }],
  department: [{ required: true, message: '请选择或输入申请部门', trigger: 'change' }],
  devOwnerA: [{ required: false }],
  devOwnerB: [{ required: false }],
  changeSystem: [{ required: true, message: '请选择或输入变更系统', trigger: 'change' }],
  needsReport: [{ required: true, message: '请选择是否需要报备', trigger: 'change' }],
  expectedChangeDate: [{ required: true, message: '请选择期望变更日期', trigger: 'change' }],
  changeItems: [{ validator: validateChangeItems, trigger: 'change' }],
  riskDescription: [{ required: true, message: '请填写变更风险说明', trigger: 'blur' }],
  relatedChange: [{ required: true, message: '请选择是否涉及关联变更', trigger: 'change' }],
  relatedSystems: [{ validator: validateRelatedSystems, trigger: 'blur' }],
  implementationPlan: [{ required: true, message: '请填写变更实施方案', trigger: 'blur' }],
  rollbackPlan: [
    { required: true, message: '请填写数据及程序的备份回退方案', trigger: 'blur' },
  ],
  verifier1: [{ required: true, message: '请填写变更验证人1', trigger: 'blur' }],
  verifierContact: [{ required: true, message: '请填写联系方式', trigger: 'blur' }],
  nextDayDuty: [{ required: true, message: '请填写次日值守人员', trigger: 'blur' }],
  dutyContact: [{ required: true, message: '请填写值守人员联系方式', trigger: 'blur' }],
  verificationPlan: [{ required: true, message: '请填写变更验证方案', trigger: 'blur' }],
  networkChangeTime: [{ validator: validateNetworkTime, trigger: 'change' }],
  resourceChangeTime: [{ validator: validateResourceTime, trigger: 'change' }],
};

function addChangeItem() {
  if (form.changeItems.length >= 50) {
    ElMessage.warning('变更功能点最多支持 50 行');
    return;
  }
  form.changeItems.push(makeItem());
  formRef.value?.clearValidate('changeItems');
}

function removeChangeItem(index) {
  form.changeItems.splice(index, 1);
  formRef.value?.clearValidate('changeItems');
}

function handleNetworkChange(values) {
  if (values.includes('网络') && !form.networkChangeTime) {
    form.networkChangeTime = form.expectedChangeDate || '';
  }
  if (values.includes('资源') && !form.resourceChangeTime) {
    form.resourceChangeTime = form.expectedChangeDate || '';
  }
  formRef.value?.clearValidate(['networkChangeTime', 'resourceChangeTime']);
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
      // 导出前再次读取服务端日期，确保申请日期始终为当前日期
      const dateResponse = await api.get('/form/date');
      form.applicationDate = dateResponse.data.applicationDate;

      const response = await api.post(
        '/exports',
        { ...form, sourceRecordId: editingRecordId.value || null },
        { responseType: 'blob' },
      );
      const recordId = response.headers['x-record-id'];
      const fallbackName = `${form.changeSystem}+${dateToDot(
        form.expectedChangeDate,
      )}+变更申请表.docx`;
      const fileName = filenameFromDisposition(
        response.headers['content-disposition'],
        fallbackName,
      );

      downloadBlob(response.data, fileName);
      lastExport.value = { id: recordId || null, fileName };
      ElMessage.success(
        recordId ? `导出成功，已生成留痕记录 #${recordId}` : 'Word 文档导出成功',
      );
    } catch (error) {
      ElMessage.error(await getErrorMessage(error, '导出失败，请稍后重试'));
    } finally {
      exporting.value = false;
    }
  });
}

function openPlanForm() {
  if (loading.value || loadError.value) return;
  formRef.value?.validate(async (valid, fields) => {
    if (!valid) {
      const firstField = Object.keys(fields || {})[0];
      if (firstField) formRef.value?.scrollToField(firstField);
      ElMessage.warning('请先完善申请表，再编辑变更方案');
      return;
    }

    planOpening.value = true;
    try {
      const { data } = await api.post('/plans/session', {
        changeItems: form.changeItems.map((item) => ({
          category: item.category,
          featureName: item.featureName,
        })),
        changeSystem: form.changeSystem,
        expectedChangeDate: form.expectedChangeDate,
        verificationPlan: form.verificationPlan,
        sourceApplicationRecordId: editingRecordId.value || null,
      });
      router.push({ name: 'plan-form', query: { session: data.sessionId } });
    } catch (error) {
      ElMessage.error(await getErrorMessage(error, '创建变更方案失败'));
    } finally {
      planOpening.value = false;
    }
  });
}

async function restoreSample() {
  try {
    await ElMessageBox.confirm(
      '将使用示例数据覆盖当前表单内容（服务端会重新生成申请日期），是否继续？',
      '恢复示例数据',
      {
        confirmButtonText: '恢复示例',
        cancelButtonText: '取消',
        type: 'warning',
      },
    );

    if (editingRecordId.value) {
      await router.replace('/form');
      return;
    }

    const { data } = await api.get('/form/init');
    setGroupData(data.groups);
    fillForm(data.defaults, data.applicationDate);
    lastExport.value = null;
    formRef.value?.clearValidate();
    ElMessage.success('已恢复示例数据');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(await getErrorMessage(error, '恢复失败'));
    }
  }
}

onMounted(loadInitialData);
</script>

<template>
  <div class="page form-page">
    <PageHero
      eyebrow="FINANCIAL SYSTEM · CHANGE REQUEST"
      title="变更申请表"
      description="填写变更信息并导出正式 Word 申请单。每次导出都会保存完整表单快照，可随时查看或基于历史记录重新编辑。"
    >
      <el-button :disabled="loading || !!loadError" @click="router.push('/records')">
        <el-icon><Tickets /></el-icon>
        导出记录
      </el-button>
      <el-button
        type="primary"
        :loading="exporting"
        :disabled="loading || !!loadError"
        @click="handleExport"
      >
        <el-icon v-if="!exporting"><Download /></el-icon>
        导出 Word
      </el-button>
      <el-button
        :loading="planOpening"
        :disabled="loading || !!loadError"
        @click="openPlanForm"
      >
        <el-icon v-if="!planOpening"><DocumentAdd /></el-icon>
        编辑变更方案
      </el-button>
    </PageHero>

    <div v-if="loadError" class="paper-card error-shell">
      <div class="error-inner">
        <h2>表单加载失败</h2>
        <p>{{ loadError }}</p>
        <el-button type="primary" @click="loadInitialData">重新加载</el-button>
      </div>
    </div>

    <div v-else-if="loading" class="paper-card loading-shell">
      <div class="loading-inner">
        <span class="loading-spinner" aria-hidden="true"></span>
        <p>正在读取表单与服务端日期…</p>
      </div>
    </div>

    <template v-else>
      <div v-if="editingRecordId" class="context-banner">
        <el-icon><InfoFilled /></el-icon>
        <div>
          <strong>正在重新编辑历史记录 #{{ String(editingRecordId).padStart(4, '0') }}</strong>
          <span v-if="editingFileName"> · {{ editingFileName }}</span>
          <br />
          申请日期已按规则更新为服务端当前日期；本次导出会生成一条新记录，原记录不会被覆盖。
        </div>
        <router-link to="/records">返回记录</router-link>
      </div>

      <div v-if="lastExport" class="export-success">
        <el-icon><CircleCheckFilled /></el-icon>
        <span>
          导出成功，{{ lastExport.fileName }}
          <template v-if="lastExport.id"> · 留痕记录 #{{ lastExport.id }}</template>
        </span>
        <router-link to="/records">查看留痕</router-link>
      </div>

      <div class="legend">
        <span class="legend-item"><i class="legend-dot manual"></i>手工填写</span>
        <span class="legend-item"><i class="legend-dot select"></i>下拉选择，也可直接录入</span>
        <span class="legend-item"><i class="legend-dot required"></i>带 * 为必填项</span>
        <span class="legend-item">
          <el-icon style="font-size: 13px; color: var(--accent)"><Calendar /></el-icon>
          申请日期由服务端自动生成
        </span>
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        class="change-form"
        @submit.prevent="handleExport"
      >
        <section class="paper-card">
          <div class="section-head">
            <span class="section-index">01</span>
            <div class="section-heading">
              <h2>基础信息</h2>
              <p>申请人、所属部门与本次变更的基本安排。</p>
            </div>
          </div>
          <div class="section-body">
            <div class="form-grid">
              <el-form-item class="col-4" prop="applicant">
                <template #label><FieldLabel text="变更申请人" type="manual" /></template>
                <el-input v-model="form.applicant" placeholder="请输入变更申请人" maxlength="80" />
              </el-form-item>

              <el-form-item class="col-4" prop="department">
                <template #label>
                  <FieldLabel text="申请部门" type="select" hint="可选择或录入" />
                </template>
                <el-select
                  v-model="form.department"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="选择或输入申请部门"
                >
                  <el-option
                    v-for="option in departmentOptions"
                    :key="option"
                    :label="option"
                    :value="option"
                  />
                </el-select>
              </el-form-item>

              <el-form-item class="col-4">
                <template #label><FieldLabel text="申请日期" /></template>
                <div class="date-lock">
                  <el-icon><Calendar /></el-icon>
                  <span class="date-lock-text">{{ formatDateDot(form.applicationDate) }}</span>
                  <span class="lock-tag">系统生成 · 不可修改</span>
                </div>
              </el-form-item>

              <el-form-item class="col-4" prop="devOwnerA">
                <template #label><FieldLabel text="开发负责人 A" type="manual" /></template>
                <el-input v-model="form.devOwnerA" placeholder="请输入开发负责人 A" maxlength="80" />
              </el-form-item>

              <el-form-item class="col-4" prop="devOwnerB">
                <template #label><FieldLabel text="开发负责人 B" type="manual" /></template>
                <el-input v-model="form.devOwnerB" placeholder="请输入开发负责人 B" maxlength="80" />
              </el-form-item>

              <el-form-item class="col-4" prop="changeSystem">
                <template #label>
                  <FieldLabel text="变更系统" type="select" hint="可选择或录入" />
                </template>
                <el-select
                  v-model="form.changeSystem"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="选择或输入变更系统"
                >
                  <el-option
                    v-for="option in systemOptions"
                    :key="option"
                    :label="option"
                    :value="option"
                  />
                </el-select>
              </el-form-item>

              <el-form-item class="col-6" prop="needsReport">
                <template #label><FieldLabel text="是否需要报备" /></template>
                <ChoiceGroup v-model="form.needsReport" :options="['是', '否']" />
              </el-form-item>

              <el-form-item class="col-6" prop="expectedChangeDate">
                <template #label><FieldLabel text="期望变更日期" type="manual" /></template>
                <el-date-picker
                  v-model="form.expectedChangeDate"
                  type="date"
                  value-format="YYYY-MM-DD"
                  format="YYYY.MM.DD"
                  placeholder="选择期望变更日期"
                />
              </el-form-item>
            </div>
          </div>
        </section>

        <section class="paper-card">
          <div class="section-head">
            <span class="section-index">02</span>
            <div class="section-heading">
              <h2>变更内容</h2>
              <p>逐条列出本次变更功能点，并说明变更影响与风险范围。</p>
            </div>
            <div class="section-head-actions">
              <el-button type="primary" plain size="small" @click="addChangeItem">
                <el-icon><Plus /></el-icon>
                新增功能点
              </el-button>
            </div>
          </div>
          <div class="section-body">
            <el-form-item prop="changeItems" class="items-form-item">
              <div class="items-table">
                <div class="items-head">
                  <span>编号</span>
                  <span><i class="field-marker select"></i>变更类别</span>
                  <span><i class="field-marker manual"></i>功能点名称</span>
                  <span>操作</span>
                </div>
                <div v-if="!form.changeItems.length" class="items-empty">
                  暂无变更功能点，请点击下方按钮新增。
                </div>
                <div v-for="(item, index) in form.changeItems" :key="item._key" class="items-row">
                  <span class="item-seq">{{ padNumber(index + 1) }}</span>
                  <el-select
                    v-model="item.category"
                    filterable
                    allow-create
                    default-first-option
                    placeholder="选择或输入类别"
                  >
                    <el-option
                      v-for="option in categoryOptions"
                      :key="option"
                      :label="option"
                      :value="option"
                    />
                  </el-select>
                  <el-input
                    v-model="item.featureName"
                    placeholder="填写功能点名称"
                    maxlength="1000"
                  />
                  <el-button
                    class="item-delete"
                    text
                    :icon="Delete"
                    aria-label="删除该行"
                    @click="removeChangeItem(index)"
                  />
                </div>
              </div>
              <el-button class="add-item-btn" @click="addChangeItem">
                <el-icon><Plus /></el-icon>
                新增一行
              </el-button>
            </el-form-item>

            <el-form-item prop="riskDescription">
              <template #label>
                <FieldLabel text="变更影响及范围等变更风险说明" type="manual" />
              </template>
              <el-input
                v-model="form.riskDescription"
                type="textarea"
                :rows="3"
                maxlength="5000"
                show-word-limit
                placeholder="说明本次变更的影响范围、风险点与应对措施"
              />
            </el-form-item>
          </div>
        </section>

        <section class="paper-card">
          <div class="section-head">
            <span class="section-index">03</span>
            <div class="section-heading">
              <h2>影响范围</h2>
              <p>标记关联系统、数据库对象以及网络资源层面的影响。</p>
            </div>
          </div>
          <div class="section-body">
            <div class="form-grid">
              <el-form-item class="col-4" prop="relatedChange">
                <template #label><FieldLabel text="是否涉及其他系统关联变更" /></template>
                <ChoiceGroup v-model="form.relatedChange" :options="['是', '否']" />
              </el-form-item>

              <el-form-item v-if="form.relatedChange === '是'" class="col-8" prop="relatedSystems">
                <template #label><FieldLabel text="关联系统" type="manual" /></template>
                <el-input
                  v-model="form.relatedSystems"
                  maxlength="1000"
                  placeholder="例如：AA系统、BB系统、CC系统"
                />
              </el-form-item>

              <el-form-item class="col-12">
                <template #label><FieldLabel text="是否涉及数据库" /></template>
                <ChoiceGroup
                  v-model="form.databaseChanges"
                  :options="['表结构', '索引', '触发器', '存储过程']"
                  multiple
                />
                <el-input
                  v-model="form.ddlDml"
                  class="database-reference"
                  type="textarea"
                  :rows="2"
                  maxlength="5000"
                  placeholder="DDL 与 DML（补充参考）：如涉及数据库，请填写对应的语句或说明"
                />
              </el-form-item>

              <el-form-item class="col-12">
                <template #label><FieldLabel text="是否涉及网络和资源变更" /></template>
                <ChoiceGroup
                  v-model="form.networkChanges"
                  :options="['网络', '资源']"
                  multiple
                  @change="handleNetworkChange"
                />
              </el-form-item>

              <el-form-item
                v-if="form.networkChanges.includes('网络')"
                class="col-6"
                prop="networkChangeTime"
              >
                <template #label><FieldLabel text="网络变更时间" type="manual" /></template>
                <el-date-picker
                  v-model="form.networkChangeTime"
                  type="date"
                  value-format="YYYY-MM-DD"
                  format="YYYY.MM.DD"
                  placeholder="选择网络变更时间"
                />
              </el-form-item>

              <el-form-item
                v-if="form.networkChanges.includes('资源')"
                class="col-6"
                prop="resourceChangeTime"
              >
                <template #label><FieldLabel text="资源变更时间" type="manual" /></template>
                <el-date-picker
                  v-model="form.resourceChangeTime"
                  type="date"
                  value-format="YYYY-MM-DD"
                  format="YYYY.MM.DD"
                  placeholder="选择资源变更时间"
                />
              </el-form-item>
            </div>
          </div>
        </section>

        <section class="paper-card">
          <div class="section-head">
            <span class="section-index">04</span>
            <div class="section-heading">
              <h2>实施与回退</h2>
              <p>描述本次变更的执行步骤，以及数据与程序的备份回退策略。</p>
            </div>
          </div>
          <div class="section-body">
            <div class="form-grid">
              <el-form-item class="col-6" prop="implementationPlan">
                <template #label><FieldLabel text="变更实施方案" type="manual" /></template>
                <el-input
                  v-model="form.implementationPlan"
                  type="textarea"
                  :rows="6"
                  maxlength="10000"
                  show-word-limit
                  placeholder="填写部署、切换、执行的具体步骤"
                />
              </el-form-item>

              <el-form-item class="col-6" prop="rollbackPlan">
                <template #label>
                  <FieldLabel
                    text="数据及程序的备份回退方案"
                    type="manual"
                    hint="有关联变更时需说明回退策略"
                  />
                </template>
                <el-input
                  v-model="form.rollbackPlan"
                  type="textarea"
                  :rows="6"
                  maxlength="10000"
                  show-word-limit
                  placeholder="填写备份方式与回退步骤；如有关联变更，请说明关联系统回退策略"
                />
              </el-form-item>
            </div>
          </div>
        </section>

        <section class="paper-card">
          <div class="section-head">
            <span class="section-index">05</span>
            <div class="section-heading">
              <h2>验证与值守</h2>
              <p>明确变更验证人、次日值守人员与验证方式。</p>
            </div>
          </div>
          <div class="section-body">
            <div class="form-grid">
              <el-form-item class="col-3" prop="verifier1">
                <template #label><FieldLabel text="变更验证人 1" type="manual" /></template>
                <el-input v-model="form.verifier1" maxlength="80" placeholder="请输入姓名" />
              </el-form-item>

              <el-form-item class="col-3" prop="verifierContact">
                <template #label><FieldLabel text="联系方式" type="manual" /></template>
                <el-input
                  v-model="form.verifierContact"
                  maxlength="120"
                  placeholder="手机号 / 邮箱"
                />
              </el-form-item>

              <el-form-item class="col-3" prop="nextDayDuty">
                <template #label><FieldLabel text="次日值守人员" type="manual" /></template>
                <el-input v-model="form.nextDayDuty" maxlength="80" placeholder="请输入姓名" />
              </el-form-item>

              <el-form-item class="col-3" prop="dutyContact">
                <template #label><FieldLabel text="值守人员联系方式" type="manual" /></template>
                <el-input v-model="form.dutyContact" maxlength="120" placeholder="手机号 / 邮箱" />
              </el-form-item>

              <el-form-item class="col-12" prop="verificationPlan">
                <template #label><FieldLabel text="变更验证方案" type="manual" /></template>
                <el-input
                  v-model="form.verificationPlan"
                  type="textarea"
                  :rows="4"
                  maxlength="10000"
                  show-word-limit
                  placeholder="填写验证步骤与预期结果；如现有条件下无法有效验证，请注明原因"
                />
              </el-form-item>
            </div>
          </div>
        </section>
      </el-form>

      <div class="form-footer">
        <div class="form-footer-note">
          <el-icon><InfoFilled /></el-icon>
          <span>导出后将在浏览器下载 Word 文件，同时自动保存本次填写留痕。</span>
        </div>
        <div class="form-footer-actions">
          <el-button @click="restoreSample">
            <el-icon><RefreshLeft /></el-icon>
            恢复示例数据
          </el-button>
          <el-button :loading="planOpening" @click="openPlanForm">
            <el-icon v-if="!planOpening"><DocumentAdd /></el-icon>
            编辑变更方案
          </el-button>
          <el-button type="primary" :loading="exporting" @click="handleExport">
            <el-icon v-if="!exporting"><Download /></el-icon>
            导出 Word
          </el-button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.form-page {
  --form-accent: var(--accent);
}

.legend {
  margin-bottom: 18px;
}

.form-page .paper-card {
  overflow: hidden;
}

.form-page :deep(.el-form-item__content) {
  min-width: 0;
}

.form-page :deep(.el-select),
.form-page :deep(.el-date-editor) {
  width: 100%;
}

.context-banner > div {
  line-height: 1.65;
}

.items-table + .add-item-btn {
  margin-top: 10px;
}

.database-reference {
  margin-top: 10px;
}

@media (max-width: 860px) {
  .legend {
    padding: 11px 13px;
  }
}
</style>
