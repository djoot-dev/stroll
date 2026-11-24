<script setup lang="ts">
import { Keyboard } from '@lucide/vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'

interface ShortcutItem {
  id: string
  keys: string[]
  matchKeys: string[]
  action: string
  detail: string
}

const SHORTCUTS: ShortcutItem[] = [
  {
    id: 'overview',
    keys: ['O', '0'],
    matchKeys: ['o', '0'],
    action: 'Toggle PR Overview',
    detail: 'Jump between your current diff step and the PR description, checks, and commits.',
  },
  {
    id: 'next',
    keys: ['L', '→'],
    matchKeys: ['l', 'arrowright'],
    action: 'Next step',
    detail: 'Advance to the next file in the dependency-ordered tour.',
  },
  {
    id: 'prev',
    keys: ['H', '←'],
    matchKeys: ['h', 'arrowleft'],
    action: 'Previous step',
    detail: 'Step backward to revisit an earlier dependency or type definition.',
  },
  {
    id: 'down',
    keys: ['J', '↓'],
    matchKeys: ['j', 'arrowdown'],
    action: 'Scroll down',
    detail: 'Smoothly scroll down through the active CodeMirror diff.',
  },
  {
    id: 'up',
    keys: ['K', '↑'],
    matchKeys: ['k', 'arrowup'],
    action: 'Scroll up',
    detail: 'Smoothly scroll back up through the active diff.',
  },
  {
    id: 'mark',
    keys: ['M'],
    matchKeys: ['m'],
    action: 'Mark step reviewed',
    detail: 'Toggle reviewed status on the current file and track tour progress.',
  },
  {
    id: 'sidebar',
    keys: ['['],
    matchKeys: ['['],
    action: 'Toggle tour sidebar',
    detail: 'Collapse or expand the left guided-tour rail for maximum diff width.',
  },
  {
    id: 'finish',
    keys: ['R'],
    matchKeys: ['r'],
    action: 'Finish review',
    detail: 'Open the review submission modal (Approve, Request Changes, or Comment).',
  },
  {
    id: 'palette',
    keys: ['⌘/Ctrl', 'K'],
    matchKeys: [],
    action: 'Command palette',
    detail: 'Fuzzy-jump to any file, :line, symbol, review thread, or action.',
  },
  {
    id: 'find',
    keys: ['⌘/Ctrl', 'F'],
    matchKeys: [],
    action: 'Search in diff',
    detail: 'Find matches inside the current file diff without losing scroll position.',
  },
  {
    id: 'settings',
    keys: ['⌘/Ctrl', ','],
    matchKeys: [],
    action: 'Open settings',
    detail: 'Configure theme, local Git repos for AST intelligence, and notifications.',
  },
  {
    id: 'esc',
    keys: ['Esc'],
    matchKeys: ['escape'],
    action: 'Close overlay',
    detail: 'Dismiss any active modal, command palette, or in-diff search bar.',
  },
]

const selectedId = ref<string>('next')

const activeShortcut = computed(
  () => SHORTCUTS.find((s) => s.id === selectedId.value) ?? SHORTCUTS[0],
)

function handleKeydown(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  const k = e.key.toLowerCase()
  const match = SHORTCUTS.find((s) => s.matchKeys.includes(k))
  if (match) {
    selectedId.value = match.id
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <section
    id="shortcuts"
    class="border-y border-border-muted bg-canvas-subtle/60 py-16 sm:py-24"
  >
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <div class="mx-auto max-w-2xl text-center">
        <span
          class="inline-flex items-center gap-1.5 rounded-full border border-terra-border bg-terra-soft px-3 py-1 text-xs font-medium text-terra-text"
        >
          <Keyboard class="h-3.5 w-3.5" />
          Keyboard-First Workflow
        </span>
        <h2 class="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Navigate an entire PR without touching the mouse.
        </h2>
        <p class="mt-3 text-sm text-ink-secondary sm:text-base">
          Click a shortcut (or press a key on your keyboard) to inspect how
          Stroll keeps your hands on the home row.
        </p>
      </div>

      <!-- Live readout bar -->
      <div
        class="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-xl border border-terra-border bg-canvas px-4 py-3 shadow-card"
      >
        <div class="flex items-center gap-2.5">
          <div class="flex items-center gap-1">
            <kbd
              v-for="k in activeShortcut.keys"
              :key="k"
              class="rounded-md border border-border bg-canvas-subtle px-2 py-0.5 font-mono text-xs font-semibold text-terra-text shadow-xs"
            >
              {{ k }}
            </kbd>
          </div>
          <span class="text-sm font-semibold text-ink">{{ activeShortcut.action }}</span>
        </div>
        <p class="text-xs text-ink-secondary">{{ activeShortcut.detail }}</p>
      </div>

      <!-- Keycap grid -->
      <div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <button
          v-for="item in SHORTCUTS"
          :key="item.id"
          type="button"
          class="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-all"
          :class="
            selectedId === item.id
              ? 'border-terra-border bg-terra-soft shadow-card'
              : 'border-border-muted bg-canvas hover:border-border'
          "
          @click="selectedId = item.id"
        >
          <span class="text-xs font-medium text-ink">{{ item.action }}</span>
          <span class="flex shrink-0 items-center gap-1">
            <kbd
              v-for="k in item.keys"
              :key="k"
              class="rounded border border-border bg-canvas-subtle px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-secondary"
            >
              {{ k }}
            </kbd>
          </span>
        </button>
      </div>
    </div>
  </section>
</template>
