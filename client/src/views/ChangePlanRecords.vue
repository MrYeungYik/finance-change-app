<script setup>
// 变更方案记录：列表检索、查看详情、下载 Word、重新编辑、保存为模板
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Close,
  Document,
  DocumentAdd,
  Download,
  EditPen,
  Refresh,
  Search,
  View,
} from '@element-plus/icons-vue';
import PageHero from '../components/PageHero.vue';
import PlanRecordDetail from '../components/PlanRecordDetail.vue';
import { api, downloadBlob, getErrorMessage } from '../api';
import { dateToDot, formatDateTime, padNumber } from '../utils/format';

const router = useRouter();
const records = ref([]);
const loading = ref(true);
const loadError = ref('');
const keyword = ref('');
const page = ref(1);
const pageSize = 8;

const drawerVisible = ref(false);
const detailLoading = ref(false);
const activeRecord = ref(null);
const downloadingId = ref(null);
const savingTemplateId = ref(null);

const filteredRecords = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  if (!query) return records.value;
  return records.value.filter((record) =>
    [record.fileName, record.changeSystem, String(record.id)]
      .join(' ')
      .toLowerCase()
      .includes(query),
  );
});

const pagedRecords = computed(() => {
  const start = (page.value - 1) * pageSize;
  return filteredRecords.value.slice(start, start + pageSize);
});

const systemCount = computed(
  () => new Set(records.value.map((record) => record.changeSystem).filter(Boolean)).size,
);

const latestExport = computed(() =>
  records.value.length ? formatDateTime(records.value[0].exportedAt) : '—',
);

watch(keyword, () => {
  page.value = 1;
});

async function loadRecords() {
  loading.value = true;
  loadError.value = '';
  try {
    const { data } = await api.get('/plans');
    records.value = Array.isArray(data.records) ? data.records : [];
    if ((page.value - 1) * pageSize >= filteredRecords.value.length) {
      page.value = 1;
    }
  } catch (error) {
    loadError.value = await getErrorMessage(error, '加载变更方案记录失败');
  } finally {
    loading.value = false;
  }
}

async function openDetail(record) {
  activeRecord.value = record;
  drawerVisible.value = true;
  detailLoading.value = true;
  try {
    const { data } = await api.get(`/plans/${record.id}`);
    activeRecord.value = data.record;
  } catch (error) {
    drawerVisible.value = false;
    ElMessage.error(await getErrorMessage(error, '读取方案详情失败'));
  } finally {
    detailLoading.value = false;
  }
}

async function downloadRecord(record) {
  if (!record) return;
  downloadingId.value = record.id;
  try {
    const response = await api.get(`/plans/${record.id}/file`, {
      responseType: 'blob',
    });
    downloadBlob(response.data, record.fileName);
  } catch (error) {
    ElMessage.error(await getErrorMessage(error, '下载变更方案 Word 失败'));
  } finally {
    downloadingId.value = null;
  }
}

function reedit(record) {
  drawerVisible.value = false;
  router.push({ name: 'plan-form', query: { record: record.id } });
}

async function saveAsTemplate(record) {
  if (!record) return;
  savingTemplateId.value = record.id;
  try {
    const { value } = await ElMessageBox.prompt('请输入模板名称', '设为模板', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: `${record.changeSystem || '变更方案'}模板`,
      inputPattern: /\S+/,
      inputErrorMessage: '模板名称不能为空',
    });
    await api.post(`/plans/${record.id}/template`, { name: value.trim() });
    ElMessage.success('已保存为模板，新建变更方案时可选择使用');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(await getErrorMessage(error, '保存模板失败'));
    }
  } finally {
    savingTemplateId.value = null;
  }
}

onMounted(loadRecords);
</script>

<template>
  <div class="page">
    <PageHero
      eyebrow="CHANGE PLAN · AUDIT TRAIL"
      title="变更方案记录"
      description="每次导出变更方案都会保存完整内容快照。可以查看详情、下载 Word、基于历史记录重新编辑，或把方案保存为可复用模板。"
    >
      <el-button :loading="loading" @click="loadRecords">
        <el-icon><Refresh /></el-icon>
        刷新记录
      </el-button>
      <el-button type="primary" @click="router.push({ name: 'form' })">
        <el-icon><Document /></el-icon>
        去填写申请表
      </el-button>
    </PageHero>

    <div class="stat-strip">
      <div class="stat-card">
        <span>累计变更方案</span>
        <strong>{{ records.length }} <small>条</small></strong>
      </div>
      <div class="stat-card">
        <span>涉及变更系统</span>
        <strong>{{ systemCount }} <small>个</small></strong>
      </div>
      <div class="stat-card">
        <span>最近一次导出</span>
        <strong class="stat-time">{{ latestExport }}</strong>
      </div>
    </div>

    <div v-if="loadError" class="context-banner records-error">
      <el-icon><Close /></el-icon>
      <div>{{ loadError }}</div>
      <el-button link type="primary" @click="loadRecords">重试</el-button>
    </div>

    <section class="paper-card records-card">
      <div class="records-toolbar">
        <el-input v-model="keyword" clearable placeholder="搜索文件名、变更系统或记录编号">
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <span class="toolbar-meta">共 {{ filteredRecords.length }} 条记录</span>
      </div>

      <div class="records-table-wrap desktop-table" v-loading="loading">
        <el-table :data="pagedRecords" style="width: 100%" row-key="id">
          <el-table-column label="记录" width="90">
            <template #default="{ row }">
              <span class="record-id">#{{ padNumber(row.id, 4) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="导出时间" width="170">
            <template #default="{ row }">
              <span class="time-cell">{{ formatDateTime(row.exportedAt) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="文件名称" min-width="260">
            <template #default="{ row }">
              <button
                class="plan-file-button"
                type="button"
                :title="`点击下载 ${row.fileName}`"
                :disabled="downloadingId === row.id"
                @click="downloadRecord(row)"
              >
                <el-icon><Document /></el-icon>
                <span>{{ row.fileName }}</span>
              </button>
            </template>
          </el-table-column>

          <el-table-column label="变更系统" prop="changeSystem" min-width="130" show-overflow-tooltip />
          <el-table-column label="期望变更日期" width="120">
            <template #default="{ row }">
              <span class="time-cell">{{ dateToDot(row.expectedChangeDate) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="278" align="right" fixed="right">
            <template #default="{ row }">
              <div class="row-actions">
                <el-button link type="primary" @click="openDetail(row)">
                  <el-icon><View /></el-icon>
                  查看
                </el-button>
                <el-button link type="primary" @click="reedit(row)">
                  <el-icon><EditPen /></el-icon>
                  重新编辑
                </el-button>
                <el-button
                  link
                  type="primary"
                  :loading="savingTemplateId === row.id"
                  @click="saveAsTemplate(row)"
                >
                  <el-icon v-if="savingTemplateId !== row.id"><DocumentAdd /></el-icon>
                  设为模板
                </el-button>
              </div>
            </template>
          </el-table-column>

          <template #empty>
            <el-empty :image-size="76">
              <template #description>
                <p class="empty-title">{{ keyword ? '没有匹配的变更方案' : '还没有变更方案记录' }}</p>
                <p class="empty-hint">
                  {{ keyword ? '换一个关键词试试' : '在变更申请表页面点击“编辑变更方案”并导出后，记录会出现在这里' }}
                </p>
              </template>
              <el-button v-if="!keyword" type="primary" plain @click="router.push({ name: 'form' })">
                去填写申请表
              </el-button>
            </el-empty>
          </template>
        </el-table>
      </div>

      <div class="records-cards mobile-table" v-loading="loading">
        <article v-for="row in pagedRecords" :key="row.id" class="record-card-mobile">
          <div class="record-card-top">
            <span class="record-id">#{{ padNumber(row.id, 4) }}</span>
            <span class="time-cell">{{ formatDateTime(row.exportedAt) }}</span>
          </div>
          <button class="record-card-file plan-file-button" type="button" @click="downloadRecord(row)">
            <el-icon><Document /></el-icon>
            <span>{{ row.fileName }}</span>
          </button>
          <dl class="record-card-meta">
            <div>
              <dt>变更系统</dt>
              <dd>{{ row.changeSystem }}</dd>
            </div>
            <div>
              <dt>期望变更日期</dt>
              <dd>{{ dateToDot(row.expectedChangeDate) }}</dd>
            </div>
          </dl>
          <div class="record-card-actions">
            <el-button size="small" @click="openDetail(row)">
              <el-icon><View /></el-icon>
              查看
            </el-button>
            <el-button size="small" type="primary" plain @click="reedit(row)">
              <el-icon><EditPen /></el-icon>
              重新编辑
            </el-button>
            <el-button
              size="small"
              text
              :loading="savingTemplateId === row.id"
              @click="saveAsTemplate(row)"
            >
              <el-icon v-if="savingTemplateId !== row.id"><DocumentAdd /></el-icon>
              设为模板
            </el-button>
          </div>
        </article>
        <el-empty v-if="!pagedRecords.length" :image-size="76">
          <template #description>
            <p class="empty-title">{{ keyword ? '没有匹配的变更方案' : '还没有变更方案记录' }}</p>
            <p class="empty-hint">
              {{ keyword ? '换一个关键词试试' : '在变更申请表页面点击“编辑变更方案”并导出后，记录会出现在这里' }}
            </p>
          </template>
          <el-button v-if="!keyword" type="primary" plain @click="router.push({ name: 'form' })">
            去填写申请表
          </el-button>
        </el-empty>
      </div>

      <div class="table-footer">
        <span class="table-footer-note">点击文件名可下载 Word；记录按导出时间倒序排列，重新编辑会生成新记录。</span>
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="filteredRecords.length"
          layout="prev, pager, next"
          background
          small
        />
      </div>
    </section>

    <el-drawer
      v-model="drawerVisible"
      class="record-drawer"
      size="860px"
      :with-header="false"
      destroy-on-close
    >
      <div class="drawer-shell" v-loading="detailLoading">
        <div class="drawer-top">
          <div>
            <p class="eyebrow">PLAN RECORD</p>
            <h2>
              变更方案
              <span v-if="activeRecord">#{{ padNumber(activeRecord.id, 4) }}</span>
            </h2>
          </div>
          <el-button circle text :icon="Close" aria-label="关闭" @click="drawerVisible = false" />
        </div>

        <PlanRecordDetail v-if="activeRecord?.planData" :record="activeRecord" />
        <div v-else-if="!detailLoading" class="loading-shell">
          <div class="error-inner">
            <p>无法读取方案详情</p>
          </div>
        </div>

        <div v-if="activeRecord?.planData" class="drawer-actions">
          <el-button
            :loading="downloadingId === activeRecord.id"
            @click="downloadRecord(activeRecord)"
          >
            <el-icon v-if="downloadingId !== activeRecord.id"><Download /></el-icon>
            下载原 Word
          </el-button>
          <el-button
            :loading="savingTemplateId === activeRecord.id"
            @click="saveAsTemplate(activeRecord)"
          >
            <el-icon v-if="savingTemplateId !== activeRecord.id"><DocumentAdd /></el-icon>
            设为模板
          </el-button>
          <el-button type="primary" @click="reedit(activeRecord)">
            <el-icon><EditPen /></el-icon>
            基于此记录重新编辑
          </el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.records-error {
  margin-bottom: 16px;
}

.records-error .el-button {
  margin-left: auto;
}

.empty-title {
  color: var(--ink-700);
  font-size: 13px;
}

.empty-hint {
  margin-top: 4px;
  color: var(--ink-400);
  font-size: 11.5px;
}

.stat-time {
  font-family: var(--font-sans) !important;
  font-size: 17px !important;
  font-weight: 600 !important;
  letter-spacing: -0.01em;
}

.plan-file-button {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.plan-file-button:hover {
  color: var(--accent);
}

.plan-file-button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-file-button .el-icon {
  flex-shrink: 0;
  color: var(--amber);
  font-size: 16px;
}

.record-card-file.plan-file-button {
  width: 100%;
}

.drawer-shell {
  padding: 28px 30px 30px;
  min-height: 100%;
}

.drawer-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--line);
}

.drawer-top .eyebrow {
  margin-bottom: 8px;
}

.drawer-top h2 {
  color: var(--ink-950);
  font-family: var(--font-serif);
  font-size: 26px;
  line-height: 1.2;
}

.drawer-top h2 span {
  color: var(--ink-400);
  font-size: 16px;
  font-weight: 400;
}

.records-card :deep(.el-empty__description) {
  margin-top: 4px;
}

@media (max-width: 860px) {
  .drawer-shell {
    padding: 20px 18px 24px;
  }

  .drawer-top h2 {
    font-size: 22px;
  }

  .stat-time {
    font-size: 14px !important;
  }
}
</style>
