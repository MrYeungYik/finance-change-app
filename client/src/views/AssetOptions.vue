<script setup>
// 资产选项维护：资产名称/资产类型按变更系统维护，IP 按资产名称维护。
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  CollectionTag,
  InfoFilled,
  Link,
  Monitor,
  Plus,
  Refresh,
} from '@element-plus/icons-vue';
import PageHero from '../components/PageHero.vue';
import { api, getErrorMessage } from '../api';

const systemOptions = ref([]);
const assetOptions = ref([]);
const ipOptions = ref([]);
const selectedSystem = ref('');
const selectedAsset = ref('');
const loading = ref(true);
const loadError = ref('');

const drafts = reactive({ assetName: '', assetType: '', ip: '' });
const adding = reactive({ assetName: false, assetType: false, ip: false });

function unique(values) {
  return [...new Set(values)];
}

const assetNamesForSystem = computed(() => unique(
  assetOptions.value
    .filter((option) => option.systemName === selectedSystem.value && option.kind === 'assetName')
    .map((option) => option.value),
));

const assetTypesForSystem = computed(() => unique(
  assetOptions.value
    .filter((option) => option.systemName === selectedSystem.value && option.kind === 'assetType')
    .map((option) => option.value),
));

const assetNameGroups = computed(() => {
  const groups = new Map();
  for (const option of assetOptions.value) {
    if (option.kind !== 'assetName') continue;
    if (!groups.has(option.systemName)) groups.set(option.systemName, new Set());
    groups.get(option.systemName).add(option.value);
  }
  return [...groups.entries()].map(([system, values]) => ({
    system,
    values: [...values],
  }));
});

const ipOptionsForSelected = computed(() => ipOptions.value
  .filter((option) => option.assetName === selectedAsset.value));

function isAssetNameOfCurrentSystem(option) {
  return option.systemName === selectedSystem.value && option.kind === 'assetName';
}

async function loadData(silent = false) {
  if (!silent) loading.value = true;
  loadError.value = '';
  try {
    const [dropdownResponse, planResponse] = await Promise.all([
      api.get('/options'),
      api.get('/plan-options'),
    ]);
    const dropdownSystems = (dropdownResponse.data.groups?.system || [])
      .map((option) => option.value);
    assetOptions.value = planResponse.data.assets || [];
    ipOptions.value = planResponse.data.ips || [];
    systemOptions.value = unique([
      ...dropdownSystems,
      ...assetOptions.value.map((option) => option.systemName),
    ]);
    if (!systemOptions.value.includes(selectedSystem.value)) {
      selectedSystem.value = systemOptions.value[0] || '';
    }
  } catch (error) {
    loadError.value = await getErrorMessage(error, '加载资产选项失败');
  } finally {
    if (!silent) loading.value = false;
  }
}

watch(
  assetNameGroups,
  (groups) => {
    const names = groups.flatMap((group) => group.values);
    if (!names.includes(selectedAsset.value)) {
      selectedAsset.value = names[0] || '';
    }
  },
  { immediate: true },
);

async function addAssetOption(kind) {
  const value = drafts[kind].trim();
  if (!selectedSystem.value) {
    ElMessage.warning('请先选择变更系统');
    return;
  }
  if (!value) {
    ElMessage.warning(`请输入${kind === 'assetName' ? '资产名称' : '资产类型'}`);
    return;
  }
  adding[kind] = true;
  try {
    const { data } = await api.post('/plan-options/assets', {
      systemName: selectedSystem.value,
      kind,
      value,
    });
    assetOptions.value.push(data.option);
    drafts[kind] = '';
    ElMessage.success('选项已添加，变更方案页实时生效');
  } catch (error) {
    ElMessage.error(await getErrorMessage(error, '新增选项失败'));
  } finally {
    adding[kind] = false;
  }
}

async function removeAssetOption(option) {
  const label = option.kind === 'assetName' ? '资产名称' : '资产类型';
  try {
    await ElMessageBox.confirm(
      `确定删除${label}“${option.value}”？已导出的方案记录不受影响。`,
      `删除${label}`,
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      },
    );
    await api.delete(`/plan-options/assets/${option.id}`);
    assetOptions.value = assetOptions.value.filter((item) => item.id !== option.id);
    ElMessage.success('选项已删除');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(await getErrorMessage(error, '删除选项失败'));
    }
  }
}

async function addIpOption() {
  const value = drafts.ip.trim();
  if (!selectedAsset.value) {
    ElMessage.warning('请先选择资产名称');
    return;
  }
  if (!value) {
    ElMessage.warning('请输入 IP 地址');
    return;
  }
  adding.ip = true;
  try {
    const { data } = await api.post('/plan-options/ips', {
      assetName: selectedAsset.value,
      value,
    });
    ipOptions.value.push(data.option);
    drafts.ip = '';
    ElMessage.success('IP 已添加，变更方案页实时生效');
  } catch (error) {
    ElMessage.error(await getErrorMessage(error, '新增 IP 失败'));
  } finally {
    adding.ip = false;
  }
}

async function removeIpOption(option) {
  try {
    await ElMessageBox.confirm(
      `确定删除 IP“${option.value}”？已导出的方案记录不受影响。`,
      '删除 IP 地址',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      },
    );
    await api.delete(`/plan-options/ips/${option.id}`);
    ipOptions.value = ipOptions.value.filter((item) => item.id !== option.id);
    ElMessage.success('IP 已删除');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(await getErrorMessage(error, '删除 IP 失败'));
    }
  }
}

onMounted(() => loadData());
</script>

<template>
  <div class="page">
    <PageHero
      eyebrow="ASSET LIBRARY · OPTIONS"
      title="资产选项维护"
      description="资产名称、资产类型按变更系统维度维护；IP 地址按资产名称维度维护。修改后立即作用于变更方案编辑页。"
    >
      <el-button :loading="loading" @click="loadData()">
        <el-icon><Refresh /></el-icon>
        刷新选项
      </el-button>
    </PageHero>

    <div class="option-tip">
      <el-icon><InfoFilled /></el-icon>
      <div>
        变更方案页的联动规则：<strong>变更系统</strong> → 资产名称 / 资产类型；
        <strong>资产名称</strong> → IP 地址。同一资产名称下的 IP 选项会在服务器表中按行联动展示。
      </div>
    </div>

    <div v-if="loadError" class="context-banner">
      <el-icon><InfoFilled /></el-icon>
      <div>{{ loadError }}</div>
      <el-button link type="primary" @click="loadData()">重试</el-button>
    </div>

    <section class="paper-card">
      <div class="section-head">
        <span class="section-index">01</span>
        <div class="section-heading">
          <h2>资产名称与资产类型</h2>
          <p>以变更系统为维度维护；方案页按当前变更系统联动展示。</p>
        </div>
      </div>
      <div v-loading="loading" class="section-body">
        <div class="asset-system-row">
          <label for="asset-system-select">变更系统</label>
          <el-select
            id="asset-system-select"
            v-model="selectedSystem"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入变更系统"
          >
            <el-option
              v-for="system in systemOptions"
              :key="system"
              :label="system"
              :value="system"
            />
          </el-select>
        </div>

        <div v-if="selectedSystem" class="option-grid asset-option-grid">
          <div class="option-card asset-option-card">
            <div class="option-card-head">
              <span class="option-icon"><el-icon><Monitor /></el-icon></span>
              <div>
                <h2>资产名称</h2>
                <p>当前系统：{{ selectedSystem }}</p>
              </div>
              <span class="option-count">{{ assetNamesForSystem.length }}</span>
            </div>
            <div class="option-card-body">
              <div class="option-add">
                <el-input
                  v-model="drafts.assetName"
                  maxlength="200"
                  placeholder="新增资产名称"
                  @keyup.enter="addAssetOption('assetName')"
                />
                <el-button
                  type="primary"
                  plain
                  :loading="adding.assetName"
                  @click="addAssetOption('assetName')"
                >
                  <el-icon v-if="!adding.assetName"><Plus /></el-icon>
                  添加
                </el-button>
              </div>
              <div class="option-tags">
                <el-tag
                  v-for="option in assetOptions.filter(isAssetNameOfCurrentSystem)"
                  :key="option.id"
                  closable
                  @close="removeAssetOption(option)"
                >
                  {{ option.value }}
                </el-tag>
                <span v-if="!assetNamesForSystem.length" class="option-empty">
                  当前系统暂无资产名称
                </span>
              </div>
            </div>
          </div>

          <div class="option-card asset-option-card">
            <div class="option-card-head">
              <span class="option-icon"><el-icon><CollectionTag /></el-icon></span>
              <div>
                <h2>资产类型</h2>
                <p>当前系统：{{ selectedSystem }}</p>
              </div>
              <span class="option-count">{{ assetTypesForSystem.length }}</span>
            </div>
            <div class="option-card-body">
              <div class="option-add">
                <el-input
                  v-model="drafts.assetType"
                  maxlength="200"
                  placeholder="新增资产类型"
                  @keyup.enter="addAssetOption('assetType')"
                />
                <el-button
                  type="primary"
                  plain
                  :loading="adding.assetType"
                  @click="addAssetOption('assetType')"
                >
                  <el-icon v-if="!adding.assetType"><Plus /></el-icon>
                  添加
                </el-button>
              </div>
              <div class="option-tags">
                <el-tag
                  v-for="option in assetOptions.filter(
                    (item) => item.systemName === selectedSystem && item.kind === 'assetType'
                  )"
                  :key="option.id"
                  closable
                  @close="removeAssetOption(option)"
                >
                  {{ option.value }}
                </el-tag>
                <span v-if="!assetTypesForSystem.length" class="option-empty">
                  当前系统暂无资产类型
                </span>
              </div>
            </div>
          </div>
        </div>

        <el-empty v-else description="请先在“下拉选项维护”中添加变更系统，或直接输入系统名称" />
      </div>
    </section>

    <section class="paper-card asset-ip-card">
      <div class="section-head">
        <span class="section-index">02</span>
        <div class="section-heading">
          <h2>IP 地址</h2>
          <p>以资产名称为维度维护；方案页选择资产名称后联动展示对应 IP。</p>
        </div>
      </div>
      <div v-loading="loading" class="section-body">
        <div class="asset-system-row">
          <label for="asset-name-select">资产名称</label>
          <el-select
            id="asset-name-select"
            v-model="selectedAsset"
            filterable
            placeholder="选择资产名称"
          >
            <el-option-group
              v-for="group in assetNameGroups"
              :key="group.system"
              :label="group.system"
            >
              <el-option
                v-for="name in group.values"
                :key="`${group.system}:${name}`"
                :label="name"
                :value="name"
              />
            </el-option-group>
          </el-select>
        </div>

        <div v-if="selectedAsset" class="option-card asset-option-card ip-option-card">
          <div class="option-card-head">
            <span class="option-icon"><el-icon><Link /></el-icon></span>
            <div>
              <h2>IP 地址</h2>
              <p>当前资产：{{ selectedAsset }}</p>
            </div>
            <span class="option-count">{{ ipOptionsForSelected.length }}</span>
          </div>
          <div class="option-card-body">
            <div class="option-add">
              <el-input
                v-model="drafts.ip"
                maxlength="200"
                placeholder="新增 IP 地址，例如 10.0.0.1"
                @keyup.enter="addIpOption"
              />
              <el-button type="primary" plain :loading="adding.ip" @click="addIpOption">
                <el-icon v-if="!adding.ip"><Plus /></el-icon>
                添加
              </el-button>
            </div>
            <div class="option-tags">
              <el-tag
                v-for="option in ipOptionsForSelected"
                :key="option.id"
                closable
                @close="removeIpOption(option)"
              >
                {{ option.value }}
              </el-tag>
              <span v-if="!ipOptionsForSelected.length" class="option-empty">
                当前资产暂无 IP 地址
              </span>
            </div>
          </div>
        </div>

        <el-empty v-else description="请先在上方为变更系统维护资产名称" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.asset-system-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}

.asset-system-row > label {
  flex-shrink: 0;
  color: var(--ink-600);
  font-size: 12.5px;
  font-weight: 600;
}

.asset-system-row .el-select {
  width: min(420px, 100%);
}

.asset-option-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.asset-option-card {
  background: #fffefb;
}

.asset-ip-card .section-body {
  padding-bottom: 24px;
}

.ip-option-card {
  max-width: 720px;
}

@media (max-width: 860px) {
  .asset-system-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .asset-system-row .el-select {
    width: 100%;
  }

  .asset-option-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
