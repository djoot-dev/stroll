<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Loader2, Plus } from '@lucide/vue'
import type { PRLabel } from '@/types/pr'

const props = defineProps<{
  appliedLabels: PRLabel[]
  loadLabels: () => Promise<PRLabel[]>
}>()

const emit = defineEmits<{
  (e: 'pick', name: string): void
  (e: 'close'): void
}>()

const LIST_WIDTH = 280
const query = ref('')
const repoLabels = ref<PRLabel[]>([])
const isLoading = ref(false)
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listStyle = ref<Record<string, string>>({})

const appliedSet = computed(
  () => new Set(props.appliedLabels.map((l) => l.name.toLowerCase())),
)

const filteredLabels = computed(() => {
  const q = query.value.trim().toLowerCase()
  return repoLabels.value.filter((l) => {
    if (appliedSet.value.has(l.name.toLowerCase())) return false
    if (!q) return true
    return (
      l.name.toLowerCase().includes(q) ||
      (l.description?.toLowerCase().includes(q) ?? false)
    )
  })
})

const canCreateNew = computed(() => {
  const q = query.value.trim()
  if (!q) return false
  const lower = q.toLowerCase()
  if (appliedSet.value.has(lower)) return false
  return !repoLabels.value.some((l) => l.name.toLowerCase() === lower)
})

const totalOptions = computed(() => filteredLabels.value.length + (canCreateNew.value ? 1 : 0))

watch(totalOptions, (len) => {
  if (len === 0) activeIndex.value = -1
  else if (activeIndex.value < 0 || activeIndex.value >= len) activeIndex.value = 0
})

function updatePosition() {
  const el = inputRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const width = Math.min(LIST_WIDTH, window.innerWidth - 16)
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
  const estimatedHeight = 260
  const fitsBelow = rect.bottom + 6 + estimatedHeight <= window.innerHeight - 8
  const top = fitsBelow
    ? rect.bottom + 6
    : Math.max(8, rect.top - estimatedHeight - 6)
  listStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
  }
}

function dotStyle(hex: string) {
  const clean = hex.replace(/^#/, '')
  return { backgroundColor: /^[0-9a-fA-F]{6}$/.test(clean) ? `#${clean}` : '#8b949e' }
}

function pickName(name: string) {
  emit('pick', name)
  query.value = ''
  activeIndex.value = 0
  void nextTick(() => inputRef.value?.focus())
}

function move(delta: number) {
  const n = totalOptions.value
  if (n === 0) return
  activeIndex.value = (activeIndex.value + delta + n) % n
}

function onConfirmKey() {
  if (activeIndex.value >= 0 && activeIndex.value < filteredLabels.value.length) {
    pickName(filteredLabels.value[activeIndex.value].name)
    return
  }
  if (canCreateNew.value && activeIndex.value === filteredLabels.value.length) {
    pickName(query.value.trim())
  }
}

function handleDocumentPointerDown(e: PointerEvent) {
  const target = e.target as Node | null
  if (!target) return
  if (inputRef.value?.contains(target)) return
  const listbox = document.getElementById('stroll-label-picker-list')
  if (listbox?.contains(target)) return
  emit('close')
}

onMounted(async () => {
  void nextTick(() => {
    inputRef.value?.focus()
    updatePosition()
  })
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
  document.addEventListener('pointerdown', handleDocumentPointerDown)

  isLoading.value = true
  try {
    repoLabels.value = await props.loadLabels()
  } finally {
    isLoading.value = false
    void nextTick(updatePosition)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
})
</script>

<template>
  <div class="inline-flex items-center">
    <input
      ref="inputRef"
      v-model="query"
      type="text"
      role="combobox"
      aria-expanded="true"
      aria-controls="stroll-label-picker-list"
      placeholder="Filter labels…"
      class="w-36 rounded-full border border-terra-border bg-canvas-inset px-2.5 py-0.5 text-[11px] text-ink placeholder:text-ink-faint focus:outline-none"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter.prevent="onConfirmKey"
      @keydown.tab.prevent="onConfirmKey"
      @keydown.esc.prevent="emit('close')"
    />

    <Teleport to="body">
      <div
        id="stroll-label-picker-list"
        role="listbox"
        :style="listStyle"
        class="fixed z-50 max-h-64 overflow-y-auto rounded-xl border border-border bg-canvas-subtle p-1 shadow-xl"
      >
        <div v-if="isLoading" class="flex items-center gap-2 px-2.5 py-2 text-[11px] text-ink-muted">
          <Loader2 class="h-3 w-3 animate-spin" />
          <span>Loading repository labels…</span>
        </div>

        <template v-else>
          <button
            v-for="(label, idx) in filteredLabels"
            :key="label.name"
            type="button"
            role="option"
            :aria-selected="idx === activeIndex"
            class="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors"
            :class="idx === activeIndex ? 'bg-canvas-elevated text-ink' : 'text-ink-secondary hover:bg-canvas-elevated/60'"
            @mouseenter="activeIndex = idx"
            @mousedown.prevent="pickName(label.name)"
          >
            <span
              class="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
              :style="dotStyle(label.color)"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium text-ink">{{ label.name }}</span>
              <span v-if="label.description" class="block truncate text-[10.5px] text-ink-faint">
                {{ label.description }}
              </span>
            </span>
          </button>

          <button
            v-if="canCreateNew"
            type="button"
            role="option"
            :aria-selected="activeIndex === filteredLabels.length"
            class="flex w-full items-center gap-2 rounded-lg border-t border-border-muted px-2.5 py-1.5 text-left text-xs transition-colors"
            :class="
              activeIndex === filteredLabels.length
                ? 'bg-terra-soft text-terra-text'
                : 'text-ink-secondary hover:bg-canvas-elevated/60'
            "
            @mouseenter="activeIndex = filteredLabels.length"
            @mousedown.prevent="pickName(query.trim())"
          >
            <Plus class="h-3 w-3 shrink-0" />
            <span class="truncate">Create label "{{ query.trim() }}"</span>
          </button>

          <div
            v-if="filteredLabels.length === 0 && !canCreateNew"
            class="px-2.5 py-2 text-[11px] text-ink-faint"
          >
            No matching labels
          </div>
        </template>
      </div>
    </Teleport>
  </div>
</template>
