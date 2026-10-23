<script setup>
defineProps({
  text: { type: String, required: true },
  type: { type: String, default: '' }, // manual | select
  hint: { type: String, default: '' },
});
</script>

<template>
  <span class="field-label">
    <i v-if="type" class="field-marker" :class="type" aria-hidden="true"></i>
    {{ text }}
    <small v-if="hint" class="field-hint">{{ hint }}</small>
  </span>
</template>
