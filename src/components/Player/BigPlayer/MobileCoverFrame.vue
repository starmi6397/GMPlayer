<template>
  <div v-if="visible" class="mobile-cover-frame" :style="frameStyle" @click="$emit('click')">
    <!-- Shimmer overlay: shown while the artwork image is still loading.
         Fades out the moment the <img> fires its load event. -->
    <Transition name="shimmer-fade">
      <div v-if="!imgLoaded" class="shimmer-overlay" />
    </Transition>

    <img
      :src="coverUrl"
      alt="cover"
      :class="{ loaded: imgLoaded }"
      @load="onImgLoad"
      @error="onImgError"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  visible: boolean;
  frameStyle: Record<string, string>;
  coverUrl: string;
}>();

defineEmits<{
  click: [];
}>();

// ── Image-load state ──────────────────────────────────────────────────────────

/**
 * Becomes `true` once the current `coverUrl` image has fired a "load" event.
 * Reset to `false` whenever the URL changes so the shimmer re-appears for the
 * next artwork before it finishes downloading.
 */
const imgLoaded = ref(false);

watch(
  () => props.coverUrl,
  (newUrl, oldUrl) => {
    if (newUrl !== oldUrl) {
      imgLoaded.value = false;
    }
  },
);

function onImgLoad(): void {
  imgLoaded.value = true;
}

/** Treat a broken image the same as a successful load — hide the shimmer. */
function onImgError(): void {
  imgLoaded.value = true;
}
</script>

<style lang="scss" scoped>
.mobile-cover-frame {
  position: absolute;
  width: 0px;
  height: 0px;
  overflow: hidden;
  cursor: pointer;
  pointer-events: auto;
  z-index: 60;
  box-shadow: 0px 12px 40px rgba(0, 0, 0, 0.35);
  transition:
    width 0.4s ease,
    height 0.4s ease,
    left 0.4s ease,
    top 0.4s ease,
    border-radius 0.4s ease;

  &:active {
    opacity: 0.9;
  }

  img {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;

    // Start fully transparent; fade in once loaded so there is never a
    // jarring "snap" where the old artwork is replaced by a blank frame.
    opacity: 0;
    transition: opacity 0.35s ease;

    &.loaded {
      opacity: 1;
    }
  }

  // ── Shimmer overlay ─────────────────────────────────────────────────────────

  .shimmer-overlay {
    position: absolute;
    inset: 0;
    z-index: 1;

    // Dark base so the shimmer is visible regardless of the player background
    background-color: rgba(255, 255, 255, 0.06);

    // Travelling highlight wave
    &::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(
        105deg,
        transparent 30%,
        rgba(255, 255, 255, 0.14) 50%,
        transparent 70%
      );
      background-size: 200% 100%;
      animation: shimmer-sweep 1.5s ease-in-out infinite;
    }
  }

  // ── Shimmer fade-out transition ─────────────────────────────────────────────

  .shimmer-fade-leave-active {
    transition: opacity 0.4s ease;
  }

  .shimmer-fade-leave-to {
    opacity: 0;
  }
}

@keyframes shimmer-sweep {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
