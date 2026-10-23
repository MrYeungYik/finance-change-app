<script setup>
// 下拉选项维护：新增、删除、CSV 批量导入
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  CollectionTag,
  Download,
  InfoFilled,
  Monitor,
  OfficeBuilding,
  Plus,
  Refresh,
  Upload,
} from '@element-plus/icons-vue';
import PageHero from '../components/PageHero.vue';
import { api, downloadBlob, getErrorMessage } from '../api';

const groupMeta = [
  {
    key: 'department',
    label: '申请部门',
    description: '用于申请表“申请部门”下拉',
    icon: OfficeBuilding,
    sample: '示例部门A\n示例部门B',
  },
  {
    key: 'system',
    label: '变更系统',
    description: '用于申请表“变更系统”下拉',
    icon: Monitor,
    sample: '示例系统A\n示例系统B',
  },
  {
    key: 'changeCategory',
    label: '变更类别',
    description: '用于功能点“变更类别”下拉',
    icon: CollectionTag,
    sample: '示例类别A\n示例类别B',
  },
];

const groups = ref({ department: [], system: [], changeCategory: [] });
const loading = ref(true);
const loadError = ref('');
const drafts = reactive({ department: '', system: '', changeCategory: '' });
const adding = reactive({ department: false, system: false, changeCategory: false });
const importing = reactive({ department: false, system: false, changeCategory: false });

async function loadOptions(silent = false) {
  if (!silent) loading.value = true;
  loadError.value = '';
  try {
    const { data } = await api.get('/options');
    groups.value = {
      department: data.groups?.department || [],
      system: data.groups?.system || [],
      changeCategory: data.groups?.changeCategory || [],
    };
  } catch (error) {
    loadError.value = await getErrorMessage(error, '加载下拉选项失败');
  } finally {
    if (!silent) loading.value = false;
  }
}

async function addOption(group) {
  const value = drafts[group].trim();
  if (!value) {
    ElMessage.warning('请输入要新增的选项内容');
    return;
  }
  adding[group] = true;
  try {
    const { data } = await api.post('/options', { group, value });
    drafts[group] = '';
    groups.value[group] = [...groups.value[group], data.option];
    ElMessage.success('选项已添加，表单下拉框实时生效');
  } catch (error) {
    ElMessage.error(await getErrorMessage(error, '新增选项失败'));
  } finally {
    adding[group] = false;
  }
}

async function removeOption(group, option) {
  try {
    await ElMessageBox.confirm(
      `确定删除选项“${option.value}”吗？删除后不影响已经导出的历史记录。`,
      '删除下拉选项',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      },
    );
    await api.delete(`/options/${option.id}`);
    groups.value[group] = groups.value[group].filter((item) => item.id !== option.id);
    ElMessage.success('选项已删除');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(await getErrorMessage(error, '删除选项失败'));
    }
  }
}

async function handleImport(group, uploadRequest) {
  const file = uploadRequest.file;
  if (!file) return;
  importing[group] = true;
  try {
    const payload = new FormData();
    payload.append('file', file);
    payload.append('group', group);
    const { data } = await api.post('/options/import', payload);
    await loadOptions(true);
    uploadRequest.onSuccess?.(data);
    ElMessage.success(data.message || 'CSV 导入完成');
  } catch (error) {
    uploadRequest.onError?.(error);
    ElMessage.error(await getErrorMessage(error, 'CSV 导入失败'));
  } finally {
    importing[group] = false;
  }
}

function downloadCsvTemplate(group) {
  const meta = groupMeta.find((item) => item.key === group);
  const content = `\uFEFFvalue\n${meta?.sample || '示例选项A\n示例选项B'}\n`;
  downloadBlob(
    new Blob([content], { type: 'text/csv;charset=utf-8' }),
    `CSV导入模板-${meta?.label || group}.csv`,
  );
}

onMounted(() => loadOptions());
</script>

<template>
  <div class="page">
    <PageHero
      eyebrow="DROPDOWN LIBRARY · OPTIONS"
      title="下拉选项维护"
      description="统一维护申请部门、变更系统与变更类别的下拉数据。修改后立即作用于申请表，无需重启服务。"
    >
      <el-button :loading="loading" @click="loadOptions()">
        <el-icon><Refresh /></el-icon>
        刷新选项
      </el-button>
    </PageHero>

    <div class="option-tip">
      <el-icon><InfoFilled /></el-icon>
      <div>
        CSV 支持“每行一个选项”，也支持 <code>group,value</code> 两列表格；第一行可为
        <code>value</code> 表头。重复选项会自动跳过，单文件不超过 2MB。
      </div>
      <button class="csv-template-btn" type="button" @click="downloadCsvTemplate('department')">
        下载示例 CSV
      </button>
    </div>

    <div v-if="loadError" class="context-banner">
      <el-icon><InfoFilled /></el-icon>
      <div>{{ loadError }}</div>
      <el-button link type="primary" @click="loadOptions()">重试</el-button>
    </div>

    <div class="option-grid" v-loading="loading">
      <section v-for="group in groupMeta" :key="group.key" class="paper-card option-card">
        <div class="option-card-head">
          <span class="option-icon">
            <el-icon><component :is="group.icon" /></el-icon>
          </span>
          <div>
            <h2>{{ group.label }}</h2>
            <p>{{ group.description }}</p>
          </div>
          <span class="option-count">{{ groups[group.key]?.length || 0 }}</span>
        </div>

        <div class="option-card-body">
          <div class="option-add">
            <el-input
              v-model="drafts[group.key]"
              maxlength="120"
              :placeholder="`新增${group.label}选项`"
              @keyup.enter="addOption(group.key)"
            />
            <el-button
              type="primary"
              plain
              :loading="adding[group.key]"
              @click="addOption(group.key)"
            >
              <el-icon v-if="!adding[group.key]"><Plus /></el-icon>
              添加
            </el-button>
          </div>

          <div class="option-tags">
            <el-tag
              v-for="option in groups[group.key]"
              :key="option.id"
              closable
              @close="removeOption(group.key, option)"
            >
              {{ option.value }}
            </el-tag>
            <span v-if="!groups[group.key]?.length" class="option-empty">
              暂无选项，可手动新增或导入 CSV
            </span>
          </div>

          <div class="option-actions">
            <el-upload
              action="#"
              :show-file-list="false"
              accept=".csv,text/csv"
              :http-request="(request) => handleImport(group.key, request)"
            >
              <el-button size="small" :loading="importing[group.key]">
                <el-icon v-if="!importing[group.key]"><Upload /></el-icon>
                导入 CSV
              </el-button>
            </el-upload>
            <el-button size="small" link @click="downloadCsvTemplate(group.key)">
              <el-icon><Download /></el-icon>
              下载模板
            </el-button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.option-grid {
  min-height: 220px;
}

.option-card .el-upload {
  display: inline-flex;
}

.option-card .el-upload .el-button {
  border-color: var(--line-strong);
  color: var(--ink-700);
}
</style>
