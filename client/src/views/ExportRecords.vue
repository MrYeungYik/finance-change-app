<script setup>
// 导出记录查询：列表检索、查看详情、下载历史 Word、重新编辑
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  Close,
  Document,
  Download,
  EditPen,
  Refresh,
  Search,
  View,
} from '@element-plus/icons-vue';
import PageHero from '../components/PageHero.vue';
import RecordDetail from '../components/RecordDetail.vue';
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

const filteredRecords = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  if (!query) return records.value;
  return records.value.filter((record) =>
    [record.fileName, record.applicant, record.changeSystem, String(record.id)]
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
    const { data } = await api.get('/exports');
    records.value = Array.isArray(data.records) ? data.records : [];
    if ((page.value - 1) * pageSize >= filteredRecords.value.length) {
      page.value = 1;
    }
  } catch (error) {
    loadError.value = await getErrorMessage(error, '加载导出记录失败');
  } finally {
    loading.value = false;
  }
}

async function openDetail(record) {
  activeRecord.value = record;
  drawerVisible.value = true;
  detailLoading.value = true;
  try {
    const { data } = await api.get(`/exports/${record.id}`);
    activeRecord.value = data.record;
  } catch (error) {
    drawerVisible.value = false;
    ElMessage.error(await getErrorMessage(error, '读取记录详情失败'));
  } finally {
    detailLoading.value = false;
  }
}

async function downloadRecord(record) {
  if (!record) return;
  downloadingId.value = record.id;
  try {
    const response = await api.get(`/exports/${record.id}/file`, {
      responseType: 'blob',
    });
    downloadBlob(response.data, record.fileName);
  } catch (error) {
    ElMessage.error(await getErrorMessage(error, '下载 Word 文件失败'));
  } finally {
    downloadingId.value = null;
  }
}

function reedit(record) {
  drawerVisible.value = false;
  router.push({ name: 'form', query: { record: record.id } });
}

onMounted(loadRecords);
</script>

<template>
  <div class="page">
    <PageHero
      eyebrow="AUDIT TRAIL · EXPORT HISTORY"
      title="导出记录查询"
      description="每一次导出都会保存完整表单快照。这里可以查看历史内容、下载已生成的 Word，或基于任意记录重新编辑并生成新记录。"
    >
      <el-button :loading="loading" @click="loadRecords">
        <el-icon><Refresh /></el-icon>
        刷新记录
      </el-button>
      <el-button type="primary" @click="router.push('/form')">
        <el-icon><Document /></el-icon>
        填写新申请
      </el-button>
    </PageHero>

    <div class="stat-strip">
      <div class="stat-card">
        <span>累计导出留痕</span>
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
        <el-input v-model="keyword" clearable placeholder="搜索文件名、申请人、变更系统或记录编号">
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

          <el-table-column label="文件名称" min-width="250">
            <template #default="{ row }">
              <div class="file-name" :title="row.fileName">
                <el-icon><Document /></el-icon>
                <span>{{ row.fileName }}</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="变更系统" prop="changeSystem" min-width="130" show-overflow-tooltip />
          <el-table-column label="申请人" prop="applicant" width="100" />
          <el-table-column label="期望变更日期" width="120">
            <template #default="{ row }">
              <span class="time-cell">{{ dateToDot(row.expectedChangeDate) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="196" align="right" fixed="right">
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
                  :loading="downloadingId === row.id"
                  aria-label="下载 Word"
                  @click="downloadRecord(row)"
                >
                  <el-icon v-if="downloadingId !== row.id"><Download /></el-icon>
                </el-button>
              </div>
            </template>
          </el-table-column>

          <template #empty>
            <el-empty :image-size="76">
              <template #description>
                <p class="empty-title">{{ keyword ? '没有匹配的导出记录' : '还没有导出记录' }}</p>
                <p class="empty-hint">
                  {{ keyword ? '换一个关键词试试' : '完成一次申请表导出后，记录会自动出现在这里' }}
                </p>
              </template>
              <el-button v-if="!keyword" type="primary" plain @click="router.push('/form')">
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
          <div class="record-card-file">
            <el-icon><Document /></el-icon>
            <span>{{ row.fileName }}</span>
          </div>
          <dl class="record-card-meta">
            <div>
              <dt>变更系统</dt>
              <dd>{{ row.changeSystem }}</dd>
            </div>
            <div>
              <dt>申请人</dt>
              <dd>{{ row.applicant }}</dd>
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
              :loading="downloadingId === row.id"
              aria-label="下载 Word"
              @click="downloadRecord(row)"
            >
              <el-icon v-if="downloadingId !== row.id"><Download /></el-icon>
              下载
            </el-button>
          </div>
        </article>
        <el-empty v-if="!pagedRecords.length" :image-size="76">
          <template #description>
            <p class="empty-title">{{ keyword ? '没有匹配的导出记录' : '还没有导出记录' }}</p>
            <p class="empty-hint">
              {{ keyword ? '换一个关键词试试' : '完成一次申请表导出后，记录会自动出现在这里' }}
            </p>
          </template>
          <el-button v-if="!keyword" type="primary" plain @click="router.push('/form')">
            去填写申请表
          </el-button>
        </el-empty>
      </div>

      <div class="table-footer">
        <span class="table-footer-note">记录按导出时间倒序排列，原始记录不会被后续编辑覆盖。</span>
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
      size="820px"
      :with-header="false"
      destroy-on-close
    >
      <div class="drawer-shell" v-loading="detailLoading">
        <div class="drawer-top">
          <div>
            <p class="eyebrow">EXPORT RECORD</p>
            <h2>
              导出记录
              <span v-if="activeRecord">#{{ padNumber(activeRecord.id, 4) }}</span>
            </h2>
          </div>
          <el-button circle text :icon="Close" aria-label="关闭" @click="drawerVisible = false" />
        </div>

        <RecordDetail v-if="activeRecord?.formData" :record="activeRecord" />
        <div v-else-if="!detailLoading" class="loading-shell">
          <div class="error-inner">
            <p>无法读取记录详情</p>
          </div>
        </div>

        <div v-if="activeRecord?.formData" class="drawer-actions">
          <el-button :loading="downloadingId === activeRecord.id" @click="downloadRecord(activeRecord)">
            <el-icon v-if="downloadingId !== activeRecord.id"><Download /></el-icon>
            下载原 Word
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
