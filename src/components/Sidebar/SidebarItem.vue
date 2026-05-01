<template>
  <n-tooltip placement="right" :disabled="!collapsed" :delay="300">
    <template #trigger>
      <router-link :to="to" :class="['sidebar-item', { collapsed }]" @click="$emit('navigate')">
        <n-icon class="sidebar-item-icon" :size="collapsed ? 22 : 20" :component="icon" />
        <span :class="['sidebar-item-label', { hidden: collapsed }]">{{ label }}</span>
      </router-link>
    </template>
    {{ label }}
  </n-tooltip>
</template>

<script setup>
import { NIcon, NTooltip } from "naive-ui";

defineProps({
  to: { type: [String, Object], required: true },
  icon: { type: Object, required: true },
  label: { type: String, required: true },
  collapsed: { type: Boolean, default: false },
});

defineEmits(["navigate"]);
</script>

<style lang="scss" scoped>
.sidebar-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  border-radius: 10px;
  text-decoration: none;
  color: var(--sidebar-text, var(--n-text-color));
  transition:
    background-color 0.2s,
    padding 0.3s ease,
    gap 0.3s ease;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;

  &.collapsed {
    justify-content: center;
    padding: 10px;
    gap: 0;
  }

  &:hover {
    background-color: var(--sidebar-hover-bg, var(--n-border-color));
  }

  &:active {
    transform: scale(0.98);
  }

  &.router-link-active {
    color: var(--main-color);
    background-color: var(--main-second-color);
    font-weight: 600;

    .sidebar-item-icon {
      color: var(--main-color);
    }
  }
}

.sidebar-item-icon {
  flex-shrink: 0;
  transition:
    color 0.2s,
    font-size 0.3s ease;
}

.sidebar-item-label {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
  opacity: 1;
  transition:
    opacity 0.2s ease 0.1s,
    flex 0.3s ease;

  &.hidden {
    flex: 0;
    opacity: 0;
    transition:
      opacity 0.1s ease,
      flex 0.3s ease;
  }
}
</style>
