<script setup lang="ts">
import { CircleArrowUp } from '@lucide/vue'
import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useUpdatesStore } from '@/stores/updates'

/**
 * Current app version, highlighted when a newer release is available.
 * `inline` sits in the shortcuts footer; `floating` is pinned to the bottom-right corner
 * for screens without the footer and only appears when an update is available.
 */
const props = withDefaults(defineProps<{ variant?: 'inline' | 'floating' }>(), { variant: 'inline' })

const updates = useUpdatesStore()
const settings = useSettingsStore()

const hasUpdate = computed(
  () => (updates.state === 'available' || updates.state === 'installing') && !!updates.availableUpdate,
)
const visible = computed(() => (props.variant === 'floating' ? hasUpdate.value : true))
const title = computed(() =>
  hasUpdate.value
    ? `Stroll v${updates.availableUpdate?.version} is available. Click to see what's new and update.`
    : 'Check for updates',
)

function openUpdates() {
  settings.openSettings('updates')
}
</script>

<template>
  <button
    v-if="visible"
    type="button"
    :title="title"
    class="inline-flex items-center gap-1.5 whitespace-nowrap font-mono transition-colors"
    :class="[
      variant === 'floating'
        ? 'stroll-card fixed bottom-3 right-3 z-30 rounded-full border border-terra-border bg-canvas-subtle px-3 py-1 text-[11px] shadow-xs hover:bg-canvas-elevated'
        : 'rounded px-1 text-[11px]',
      hasUpdate ? 'text-terra-text' : 'text-ink-faint hover:text-ink-muted',
    ]"
    @click="openUpdates"
  >
    <span v-if="hasUpdate" class="relative flex h-2 w-2">
      <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-terra opacity-60" />
      <span class="relative inline-flex h-2 w-2 rounded-full bg-terra" />
    </span>
    <span>Stroll<template v-if="updates.appVersion"> v{{ updates.appVersion }}</template></span>
    <template v-if="hasUpdate">
      <CircleArrowUp class="h-3 w-3" />
      <span class="font-sans font-medium">v{{ updates.availableUpdate?.version }} available</span>
    </template>
  </button>
</template>
