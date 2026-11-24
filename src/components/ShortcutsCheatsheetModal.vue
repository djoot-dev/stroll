<script setup lang="ts">
import { Keyboard, X } from '@lucide/vue'
import { getShortcutGroups } from '@/services/shortcuts'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const groups = getShortcutGroups()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]"
      @click.self="emit('close')"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        class="animate-pop-in w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-canvas-subtle shadow-2xl"
      >
        <div class="flex items-center justify-between border-b border-border-muted px-5 py-3.5">
          <div class="flex items-center gap-2">
            <Keyboard class="h-4 w-4 text-terra" />
            <h2 class="text-sm font-semibold text-ink">Keyboard Shortcuts</h2>
          </div>
          <button
            type="button"
            class="rounded-lg p-1 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            title="Close (Esc)"
            @click="emit('close')"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="grid gap-5 p-5 sm:grid-cols-2">
          <section
            v-for="group in groups"
            :key="group.title"
            class="space-y-2.5"
          >
            <h3 class="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {{ group.title }}
            </h3>
            <div class="space-y-1.5">
              <div
                v-for="item in group.items"
                :key="item.description"
                class="flex items-center justify-between gap-3 rounded-lg border border-border-muted bg-canvas px-3 py-1.5"
              >
                <span class="text-xs text-ink-secondary">{{ item.description }}</span>
                <span class="flex shrink-0 items-center gap-1">
                  <template v-for="(k, idx) in item.keys" :key="k">
                    <span v-if="idx > 0" class="text-[10px] text-ink-faint">/</span>
                    <kbd
                      class="rounded border border-border bg-canvas-subtle px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-ink"
                    >
                      {{ k }}
                    </kbd>
                  </template>
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>
