<script setup>
// 变更步骤表格：逐行录入步骤，序号自动生成，支持增删行。
import { ElMessage } from 'element-plus';
import { Delete, Plus } from '@element-plus/icons-vue';
import { padNumber } from '../utils/format';

const props = defineProps({
  placeholder: { type: String, default: '' },
  entityLabel: { type: String, default: '操作步骤' },
  maxRows: { type: Number, default: 200 },
});

const emit = defineEmits(['change']);
const rows = defineModel({ type: Array, required: true });

function addRow() {
  if (rows.value.length >= props.maxRows) {
    ElMessage.warning(`${props.entityLabel}最多支持 ${props.maxRows} 行`);
    return;
  }
  rows.value.push('');
  emit('change');
}

function removeRow(index) {
  rows.value.splice(index, 1);
  emit('change');
}
</script>

<template>
  <div class="step-table-wrap">
    <div class="items-table step-table">
      <div class="items-head">
        <span>编号</span>
        <span>{{ entityLabel }}</span>
        <span>操作</span>
      </div>
      <div v-if="!rows.length" class="items-empty">
        暂无{{ entityLabel }}，请点击下方按钮新增。
      </div>
      <div v-for="(row, index) in rows" :key="index" class="items-row">
        <span class="item-seq">{{ padNumber(index + 1) }}</span>
        <el-input
          v-model="rows[index]"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 4 }"
          :placeholder="placeholder"
          maxlength="5000"
        />
        <el-button
          class="item-delete"
          text
          :icon="Delete"
          aria-label="删除该行"
          @click="removeRow(index)"
        />
      </div>
    </div>
    <el-button class="add-item-btn" @click="addRow">
      <el-icon><Plus /></el-icon>
      新增一行
    </el-button>
  </div>
</template>

<style scoped>
.step-table-wrap {
  width: 100%;
}

.step-table .items-head,
.step-table .items-row {
  grid-template-columns: 64px minmax(0, 1fr) 48px;
}

.step-table .items-head span:last-child {
  justify-content: center;
}

.step-table .items-row :deep(.el-textarea__inner) {
  min-height: 38px;
  padding: 8px 11px;
  line-height: 1.6;
}
</style>
