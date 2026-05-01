<template>
  <div :class="['mobile-tab-bar', { dark: setting.getSiteTheme === 'dark' }]">
    <div
      v-for="tab in tabs"
      :key="tab.key"
      :class="['tab-item', { active: isActive(tab) }]"
      @click="router.push(tab.to)"
    >
      <n-icon :size="22" :component="tab.icon" />
      <span class="tab-label">{{ tab.label }}</span>
    </div>
  </div>
</template>

<script setup>
import { NIcon } from "naive-ui";
import { HomeTwo, FindOne, Me, SettingTwo } from "@icon-park/vue-next";
import { settingStore } from "@/store";
import { useRouter, useRoute } from "vue-router";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const setting = settingStore();

const tabs = computed(() => [
  { key: "home", to: "/", icon: HomeTwo, label: t("sidebar.tab.home") },
  { key: "discover", to: "/discover", icon: FindOne, label: t("sidebar.tab.discover") },
  { key: "library", to: "/user", icon: Me, label: t("sidebar.tab.library") },
  { key: "settings", to: "/setting", icon: SettingTwo, label: t("sidebar.tab.settings") },
]);

const isActive = (tab) => {
  if (tab.key === "home") return route.path === "/";
  return route.path.startsWith(tab.to);
};
</script>

<style lang="scss" scoped>
.mobile-tab-bar {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  // --app-safe-area-bottom is env(safe-area-inset-bottom) on Tauri mobile,
  // 0px everywhere else — so this is a no-op on desktop / browser.
  height: calc(56px + var(--app-safe-area-bottom, 0px));
  padding-bottom: var(--app-safe-area-bottom, 0px);
  background-color: var(--acrylic-bg, rgba(255, 255, 255, 0.45));
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  border-top: 1px solid var(--acrylic-border, rgba(0, 0, 0, 0.04));
  z-index: 1000;
  justify-content: space-around;
  align-items: center;
  transition: background-color 0.3s;

  &.dark {
    border-top-color: var(--acrylic-border, rgba(255, 255, 255, 0.04));
  }

  @media (max-width: 768px) {
    display: flex;
  }
}

.tab-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  flex: 1;
  height: 100%;
  cursor: pointer;
  color: #999;
  transition: color 0.3s;

  .dark & {
    color: rgba(255, 255, 255, 0.4);
  }

  &.active {
    color: var(--main-color);
  }

  &:active {
    transform: scale(0.92);
  }
}

.tab-label {
  font-size: 10px;
  line-height: 1;
}
</style>
