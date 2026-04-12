<template>
  <n-tooltip placement="right" :disabled="!collapsed" :delay="300">
    <template #trigger>
      <div :class="['sidebar-playlist-item', { collapsed }]" @click="$emit('navigate', id)">
        <img
          class="sidebar-playlist-cover"
          :src="
            cover ? cover.replace(/^http:/, 'https:') + '?param=50y50' : '/images/pic/default.png'
          "
          alt="cover"
          loading="lazy"
        />
        <span :class="['sidebar-playlist-name text-hidden', { hidden: collapsed }]">{{
          name
        }}</span>
      </div>
    </template>
    {{ name }}
  </n-tooltip>
</template>

<script setup>
import { NTooltip } from "naive-ui";

defineProps({
  id: { type: Number, required: true },
  cover: { type: String, default: "" },
  name: { type: String, required: true },
  collapsed: { type: Boolean, default: false },
});

defineEmits(["navigate"]);
</script>

<style lang="scss" scoped>
.sidebar-playlist-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  border-radius: 10px;
  cursor: pointer;
  transition:
    background-color 0.2s,
    padding 0.3s ease,
    gap 0.3s ease;
  overflow: hidden;
  white-space: nowrap;

  &.collapsed {
    justify-content: center;
    padding: 4px 0;
    gap: 0;
  }

  &:hover {
    background-color: var(--sidebar-hover-bg, var(--n-border-color));
  }

  &:active {
    transform: scale(0.98);
  }
}

.sidebar-playlist-cover {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: 8px;
  object-fit: cover;
  transition: border-radius 0.2s;

  .collapsed & {
    border-radius: 50%;
  }
}

.sidebar-playlist-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--sidebar-text, var(--n-text-color));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
