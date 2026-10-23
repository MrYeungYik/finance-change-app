<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: { type: [Array, String, null], default: undefined },
  options: { type: Array, default: () => [] },
  multiple: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'change']);

const normalizedOptions = computed(() =>
  props.options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  ),
);

function isSelected(value) {
  return props.multiple
    ? Array.isArray(props.modelValue) && props.modelValue.includes(value)
    : props.modelValue === value;
}

function toggle(value) {
  if (props.disabled) return;
  let next;
  if (props.multiple) {
    const current = Array.isArray(props.modelValue) ? [...props.modelValue] : [];
    const index = current.indexOf(value);
    if (index >= 0) current.splice(index, 1);
    else current.push(value);
    next = current;
  } else {
    next = value;
  }
  emit('update:modelValue', next);
  emit('change', next);
}
</script>

<template>
  <div class="choice-group" role="group">
    <button
      v-for="option in normalizedOptions"
      :key="option.value"
      type="button"
      class="choice-item"
      :class="{ selected: isSelected(option.value) }"
      :disabled="disabled"
      :aria-pressed="isSelected(option.value)"
      @click="toggle(option.value)"
    >
      <span class="choice-mark" aria-hidden="true">{{ isSelected(option.value) ? '●' : '○' }}</span>
      <span>{{ option.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.choice-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 42px;
  align-items: center;
}

.choice-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  padding: 5px 13px;
  border: 1px solid var(--line);
  border-radius: 9px;
  color: var(--ink-700);
  background: #fffefb;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.3;
  cursor: pointer;
  transition: border-color 150ms ease, color 150ms ease, background 150ms ease, box-shadow 150ms ease;
}

.choice-item:hover:not(:disabled) {
  border-color: var(--line-strong);
  color: var(--ink-950);
  background: var(--paper-soft);
}

.choice-item.selected {
  border-color: rgba(23, 107, 95, 0.4);
  color: var(--accent-dark);
  background: var(--accent-soft);
  box-shadow: 0 1px 0 rgba(23, 107, 95, 0.06) inset;
}

.choice-mark {
  color: var(--ink-400);
  font-size: 13px;
  line-height: 1;
  transition: color 150ms ease;
}

.choice-item.selected .choice-mark {
  color: var(--accent);
}

.choice-item:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
