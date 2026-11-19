<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getVersion } from '@tauri-apps/api/app'
import { isTauriRuntime } from '@/services/native'

const appVersion = ref('')

onMounted(async () => {
  if (!isTauriRuntime()) return
  try {
    appVersion.value = await getVersion()
  } catch {
    // Version unavailable; show the name only
  }
})
</script>

<template>
  <footer
    class="flex h-7 shrink-0 items-center justify-between border-t border-border bg-canvas-subtle px-4 text-[11px] text-slate-500"
  >
    <div class="flex items-center gap-4">
      <span><kbd class="rounded border border-border px-1 font-mono text-slate-300">L</kbd> / <kbd class="rounded border border-border px-1 font-mono text-slate-300">→</kbd> Next</span>
      <span><kbd class="rounded border border-border px-1 font-mono text-slate-300">H</kbd> / <kbd class="rounded border border-border px-1 font-mono text-slate-300">←</kbd> Prev</span>
      <span><kbd class="rounded border border-border px-1 font-mono text-slate-300">J</kbd> / <kbd class="rounded border border-border px-1 font-mono text-slate-300">↓</kbd> &amp; <kbd class="rounded border border-border px-1 font-mono text-slate-300">K</kbd> / <kbd class="rounded border border-border px-1 font-mono text-slate-300">↑</kbd> Scroll</span>
      <span><kbd class="rounded border border-border px-1 font-mono text-slate-300">M</kbd> Mark Reviewed</span>
      <span><kbd class="rounded border border-border px-1 font-mono text-slate-300">[</kbd> Toggle Sidebar</span>
      <span><kbd class="rounded border border-border px-1 font-mono text-slate-300">R</kbd> Finish Review</span>
    </div>
    <span class="hidden font-mono text-slate-600 sm:inline">Stroll<template v-if="appVersion"> v{{ appVersion }}</template></span>
  </footer>
</template>
