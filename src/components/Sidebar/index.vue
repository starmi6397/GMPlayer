<template>
  <Motion
    tag="aside"
    :class="['sidebar', { dark: setting.getSiteTheme === 'dark' }]"
    :animate="{ width: sidebarWidth, minWidth: sidebarWidth }"
    :transition="{ type: 'spring', stiffness: 320, damping: 32 }"
    :data-tauri-drag-region="isTauri || undefined"
  >
    <!-- Header: logo + collapse toggle -->
    <div :class="['sidebar-header', { collapsed: setting.sidebarCollapsed }]">
      <AnimatePresence>
        <Motion
          v-if="!setting.sidebarCollapsed"
          class="sidebar-logo"
          :initial="{ opacity: 0, scale: 0.8 }"
          :animate="{ opacity: 1, scale: 1 }"
          :exit="{ opacity: 0, scale: 0.8 }"
          :transition="{ duration: 0.2 }"
          @click="router.push('/')"
        >
          <img :src="logoUrl" alt="logo" />
        </Motion>
      </AnimatePresence>
      <n-tooltip placement="right" :disabled="!setting.sidebarCollapsed" :delay="300">
        <template #trigger>
          <n-icon
            class="sidebar-toggle"
            :size="20"
            :component="setting.sidebarCollapsed ? IndentRight : IndentLeft"
            @click="setting.sidebarCollapsed = !setting.sidebarCollapsed"
          />
        </template>
        {{ setting.sidebarCollapsed ? $t("sidebar.expand") : $t("sidebar.collapse") }}
      </n-tooltip>
    </div>

    <!-- Scrollable nav area -->
    <n-scrollbar :class="['sidebar-scroll', { collapsed: setting.sidebarCollapsed }]">
      <!-- Menu section -->
      <div :class="['sidebar-section', { collapsed: setting.sidebarCollapsed }]">
        <AnimatePresence>
          <Motion
            v-if="!setting.sidebarCollapsed"
            class="sidebar-section-title"
            :initial="{ opacity: 0 }"
            :animate="{ opacity: 1 }"
            :exit="{ opacity: 0 }"
            :transition="{ duration: 0.15 }"
          >
            {{ $t("sidebar.menu") }}
          </Motion>
        </AnimatePresence>
        <SidebarItem
          :to="'/'"
          :icon="HomeTwo"
          :label="$t('nav.home')"
          :collapsed="setting.sidebarCollapsed"
        />
        <SidebarItem
          :to="'/discover'"
          :icon="FindOne"
          :label="$t('nav.discover')"
          :collapsed="setting.sidebarCollapsed"
        />
        <SidebarItem
          v-if="user.userLogin"
          :to="'/dailySongs'"
          :icon="CalendarThirty"
          :label="$t('sidebar.dailySongs')"
          :collapsed="setting.sidebarCollapsed"
        />
      </div>

      <!-- Library section (login required) -->
      <div
        v-if="user.userLogin"
        :class="['sidebar-section', { collapsed: setting.sidebarCollapsed }]"
      >
        <AnimatePresence>
          <Motion
            v-if="!setting.sidebarCollapsed"
            class="sidebar-section-title"
            :initial="{ opacity: 0 }"
            :animate="{ opacity: 1 }"
            :exit="{ opacity: 0 }"
            :transition="{ duration: 0.15 }"
          >
            {{ $t("sidebar.library") }}
          </Motion>
        </AnimatePresence>
        <SidebarItem
          :to="'/user/playlists'"
          :icon="MusicList"
          :label="$t('sidebar.playlists')"
          :collapsed="setting.sidebarCollapsed"
        />
        <SidebarItem
          :to="'/user/album'"
          :icon="RecordDisc"
          :label="$t('sidebar.albums')"
          :collapsed="setting.sidebarCollapsed"
        />
        <SidebarItem
          :to="'/user/artists'"
          :icon="Voice"
          :label="$t('sidebar.artists')"
          :collapsed="setting.sidebarCollapsed"
        />
        <SidebarItem
          :to="'/user/cloud'"
          :icon="CloudStorage"
          :label="$t('sidebar.cloud')"
          :collapsed="setting.sidebarCollapsed"
        />
      </div>

      <!-- My Playlists section (login required) -->
      <div
        v-if="user.userLogin"
        :class="['sidebar-section', { collapsed: setting.sidebarCollapsed }]"
      >
        <AnimatePresence>
          <Motion
            v-if="!setting.sidebarCollapsed"
            class="sidebar-section-title"
            :initial="{ opacity: 0 }"
            :animate="{ opacity: 1 }"
            :exit="{ opacity: 0 }"
            :transition="{ duration: 0.15 }"
          >
            {{ $t("sidebar.myPlaylists") }}
          </Motion>
        </AnimatePresence>
        <template v-if="user.getUserPlayLists.isLoading">
          <n-skeleton
            v-for="i in 3"
            :key="i"
            :height="32"
            :width="setting.sidebarCollapsed ? 32 : '100%'"
            :round="true"
            style="margin-bottom: 6px"
          />
        </template>
        <template v-else-if="user.getUserPlayLists.own.length">
          <SidebarPlaylistItem
            v-for="pl in user.getUserPlayLists.own"
            :key="pl.id"
            :id="pl.id"
            :cover="pl.cover"
            :name="pl.name"
            :collapsed="setting.sidebarCollapsed"
            @navigate="goToPlaylist"
          />
        </template>
        <AnimatePresence>
          <Motion
            v-if="
              !setting.sidebarCollapsed &&
              !user.getUserPlayLists.isLoading &&
              !user.getUserPlayLists.own.length
            "
            class="sidebar-empty"
            :initial="{ opacity: 0 }"
            :animate="{ opacity: 1 }"
            :exit="{ opacity: 0 }"
            :transition="{ duration: 0.15 }"
          >
            {{ $t("sidebar.noPlaylists") }}
          </Motion>
        </AnimatePresence>
      </div>

      <!-- Liked Playlists section (login required) -->
      <div
        v-if="user.userLogin && user.getUserPlayLists.like.length"
        :class="['sidebar-section', { collapsed: setting.sidebarCollapsed }]"
      >
        <AnimatePresence>
          <Motion
            v-if="!setting.sidebarCollapsed"
            class="sidebar-section-title"
            :initial="{ opacity: 0 }"
            :animate="{ opacity: 1 }"
            :exit="{ opacity: 0 }"
            :transition="{ duration: 0.15 }"
          >
            {{ $t("sidebar.likedPlaylists") }}
          </Motion>
        </AnimatePresence>
        <SidebarPlaylistItem
          v-for="pl in user.getUserPlayLists.like"
          :key="pl.id"
          :id="pl.id"
          :cover="pl.cover"
          :name="pl.name"
          :collapsed="setting.sidebarCollapsed"
          @navigate="goToPlaylist"
        />
      </div>
    </n-scrollbar>

    <!-- Footer: history, settings, avatar -->
    <div :class="['sidebar-footer', { collapsed: setting.sidebarCollapsed }]">
      <SidebarItem
        :to="'/history'"
        :icon="History"
        :label="$t('sidebar.history')"
        :collapsed="setting.sidebarCollapsed"
      />
      <SidebarItem
        :to="'/setting'"
        :icon="SettingTwo"
        :label="$t('sidebar.settings')"
        :collapsed="setting.sidebarCollapsed"
      />
      <n-tooltip placement="right" :disabled="!setting.sidebarCollapsed" :delay="300">
        <template #trigger>
          <div
            :class="['sidebar-user', { collapsed: setting.sidebarCollapsed }]"
            @click="user.userLogin ? router.push('/user') : router.push('/login')"
          >
            <n-avatar
              round
              :size="setting.sidebarCollapsed ? 28 : 24"
              :src="
                user.getUserData.avatarUrl
                  ? user.getUserData.avatarUrl.replace(/^http:/, 'https:') + '?param=60y60'
                  : '/images/ico/user-filling.svg'
              "
              fallback-src="/images/ico/user-filling.svg"
            />
            <span :class="['sidebar-user-name text-hidden', { hidden: setting.sidebarCollapsed }]">
              {{ user.userLogin ? user.getUserData.nickname : $t("nav.avatar.notLogin") }}
            </span>
          </div>
        </template>
        {{ user.userLogin ? user.getUserData.nickname : $t("nav.avatar.notLogin") }}
      </n-tooltip>
    </div>
  </Motion>
</template>

<script setup lang="ts">
import {
  HomeTwo,
  FindOne,
  CalendarThirty,
  MusicList,
  RecordDisc,
  Voice,
  CloudStorage,
  History,
  SettingTwo,
  IndentLeft,
  IndentRight,
} from "@icon-park/vue-next";
import { NIcon, NAvatar, NSkeleton, NScrollbar, NTooltip } from "naive-ui";
import { Motion, AnimatePresence } from "motion-v";
import { settingStore, userStore } from "@/store";
import { useRouter } from "vue-router";
import SidebarItem from "./SidebarItem.vue";
import SidebarPlaylistItem from "./SidebarPlaylistItem.vue";

const router = useRouter();
const setting = settingStore();
const user = userStore();
const logoUrl = import.meta.env.VITE_SITE_LOGO;

const sidebarWidth = computed(() => (setting.sidebarCollapsed ? "64px" : "240px"));

// Tauri detection
const isTauri = ref(false);
onMounted(() => {
  isTauri.value = typeof window !== "undefined" && "__TAURI__" in window;
  // Load playlists if logged in
  if (user.userLogin && !user.getUserPlayLists.has) {
    user.setUserPlayLists();
  }
});

const goToPlaylist = (id) => {
  router.push({ path: "/playlist", query: { id, page: 1 } });
};
</script>

<style lang="scss" scoped>
.sidebar {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--acrylic-bg, rgba(255, 255, 255, 0.45));
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  border-right: 1px solid var(--acrylic-border, rgba(0, 0, 0, 0.04));
  transition: background-color 0.3s;
  z-index: 100;
  overflow: hidden;

  --sidebar-text: #333;
  --sidebar-text-secondary: #999;
  --sidebar-hover-bg: rgba(0, 0, 0, 0.05);
  --sidebar-divider: rgba(0, 0, 0, 0.04);

  &.dark {
    border-right-color: var(--acrylic-border, rgba(255, 255, 255, 0.04));

    --sidebar-text: rgba(255, 255, 255, 0.9);
    --sidebar-text-secondary: rgba(255, 255, 255, 0.4);
    --sidebar-hover-bg: rgba(255, 255, 255, 0.06);
    --sidebar-divider: rgba(255, 255, 255, 0.04);
  }

  @media (max-width: 768px) {
    display: none;
  }
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 8px;
  min-height: 44px;
  transition: padding 0.3s ease;

  &.collapsed {
    justify-content: center;
    padding: 12px 8px 8px;
  }
}

.sidebar-logo {
  width: 28px;
  height: 28px;
  min-width: 28px;
  cursor: pointer;

  img {
    width: 100%;
    height: 100%;
  }

  &:hover {
    cursor: pointer;
  }
}

.sidebar-toggle {
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  transition:
    background-color 0.2s,
    color 0.2s;
  color: var(--sidebar-text);

  &:hover {
    background-color: var(--sidebar-hover-bg);
  }
}

.sidebar-scroll {
  flex: 1;
  overflow: hidden;

  :deep(.n-scrollbar-rail) {
    opacity: 0;
    transition: opacity 0.3s;
  }

  &:hover {
    :deep(.n-scrollbar-rail) {
      opacity: 1;
    }
  }

  &.collapsed {
    :deep(.n-scrollbar-rail) {
      display: none;
    }
  }
}

.sidebar-section {
  padding: 4px 8px;
  transition: padding 0.3s ease;

  &.collapsed {
    padding: 4px 10px;
  }

  & + .sidebar-section {
    margin-top: 10px;
    padding-top: 4px;
  }
}

.sidebar-section-title {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  color: var(--sidebar-text-secondary);
  padding: 4px 12px 8px;
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
}

.sidebar-empty {
  font-size: 12px;
  color: var(--sidebar-text-secondary);
  padding: 8px 12px;
  white-space: nowrap;
  overflow: hidden;
}

.sidebar-footer {
  padding: 10px 8px;
  transition: padding 0.3s ease;

  &.collapsed {
    padding: 10px 10px;
  }
}

.sidebar-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition:
    background-color 0.2s,
    padding 0.3s ease,
    gap 0.3s ease;
  overflow: hidden;
  white-space: nowrap;

  &.collapsed {
    justify-content: center;
    padding: 8px;
    gap: 0;
  }

  &:hover {
    background-color: var(--sidebar-hover-bg);
  }
}

.sidebar-user-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--sidebar-text);
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

// Text fade transition for section titles
.sidebar-text-fade-enter-active {
  transition: opacity 0.25s ease 0.15s;
}

.sidebar-text-fade-leave-active {
  transition: opacity 0.1s ease;
}

.sidebar-text-fade-enter-from,
.sidebar-text-fade-leave-to {
  opacity: 0;
}
</style>
