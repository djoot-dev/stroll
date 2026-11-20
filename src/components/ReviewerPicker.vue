<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Loader2, Sparkles } from '@lucide/vue'
import type { ReviewerCandidate } from '@/services/github'

const props = defineProps<{
  search: (query: string) => Promise<ReviewerCandidate[]>
}>()

const emit = defineEmits<{
  (e: 'submit', login: string): void
  (e: 'cancel'): void
}>()

const DEBOUNCE_MS = 200
const LIST_WIDTH = 256

const query = ref('')
const candidates = ref<ReviewerCandidate[]>([])
const activeIndex = ref(-1)
const isLoading = ref(false)
const isOpen = ref(true)
const lookupFailed = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const listStyle = ref<Record<string, string>>({})

const listboxId = `reviewer-picker-${Math.random().toString(36).slice(2, 9)}`

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let requestSeq = 0

async function runSearch(q: string) {
  const seq = ++requestSeq
  isLoading.value = true
  try {
    const result = await props.search(q)
    if (seq !== requestSeq) return
    candidates.value = result
    lookupFailed.value = false
    activeIndex.value = result.length > 0 ? 0 : -1
  } catch {
    if (seq !== requestSeq) return
    // Lookup is a convenience; typing an exact login still works without it.
    candidates.value = []
    lookupFailed.value = true
    activeIndex.value = -1
  } finally {
    if (seq === requestSeq) isLoading.value = false
  }
}

watch(query, (q) => {
  isOpen.value = true
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => runSearch(q), DEBOUNCE_MS)
})

const hasSuggestedSection = computed(
  () => !query.value.trim() && candidates.value.some((c) => c.suggested),
)

const showList = computed(
  () => isOpen.value && (candidates.value.length > 0 || isLoading.value || query.value.trim() !== ''),
)

function updatePosition() {
  const el = inputRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const width = Math.min(LIST_WIDTH, window.innerWidth - 16)
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
  listStyle.value = {
    left: `${left}px`,
    top: `${rect.bottom + 6}px`,
    width: `${width}px`,
  }
}

function select(candidate: ReviewerCandidate) {
  emit('submit', candidate.login)
}

function onEnter() {
  const active = candidates.value[activeIndex.value]
  if (isOpen.value && active) {
    select(active)
    return
  }
  const raw = query.value.trim()
  if (raw) emit('submit', raw)
}

function move(delta: number) {
  if (!isOpen.value) {
    isOpen.value = true
    return
  }
  const n = candidates.value.length
  if (n === 0) return
  activeIndex.value = (activeIndex.value + delta + n) % n
  nextTick(() => {
    document
      .getElementById(`${listboxId}-opt-${activeIndex.value}`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}

function onEscape() {
  if (isOpen.value && query.value) {
    isOpen.value = false
    return
  }
  emit('cancel')
}

function onBlur() {
  isOpen.value = false
}

onMounted(() => {
  updatePosition()
  inputRef.value?.focus()
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
  runSearch('')
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  requestSeq++
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
})
</script>

<template>
  <form class="flex items-center gap-1" @submit.prevent="onEnter">
    <input
      ref="inputRef"
      v-model="query"
      type="text"
      placeholder="Search users…"
      autocomplete="off"
      spellcheck="false"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="showList"
      :aria-controls="listboxId"
      :aria-activedescendant="activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined"
      class="w-36 rounded-lg border border-terra-border bg-canvas-inset px-2 py-1 text-[11px] text-ink focus:outline-none"
      @focus="isOpen = true; updatePosition()"
      @blur="onBlur"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.esc.prevent="onEscape"
      @keydown.tab="isOpen = false"
    />
    <button
      type="submit"
      class="rounded-lg bg-terra px-2 py-1 text-[10.5px] font-semibold text-white hover:bg-terra-hover"
    >
      Request
    </button>

    <Teleport to="body">
      <div
        v-if="showList"
        :id="listboxId"
        role="listbox"
        class="animate-pop-in fixed z-50 max-h-72 overflow-y-auto rounded-xl border border-border bg-canvas-subtle p-1 shadow-lg"
        :style="listStyle"
        @mousedown.prevent
      >
        <div
          v-if="hasSuggestedSection"
          class="flex items-center gap-1 px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted"
        >
          <Sparkles class="h-3 w-3" />
          <span>Suggestions</span>
        </div>

        <template v-for="(c, i) in candidates" :key="c.login">
          <div
            v-if="hasSuggestedSection && i > 0 && !c.suggested && candidates[i - 1]?.suggested"
            class="mx-2 my-1 border-t border-border-muted"
          />
          <div
            :id="`${listboxId}-opt-${i}`"
            role="option"
            :aria-selected="i === activeIndex"
            class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs"
            :class="i === activeIndex ? 'bg-terra-soft text-ink' : 'text-ink-secondary'"
            @mouseenter="activeIndex = i"
            @click="select(c)"
          >
            <img
              v-if="c.avatarUrl"
              :src="c.avatarUrl"
              :alt="c.login"
              class="h-5 w-5 shrink-0 rounded-full border border-border"
            />
            <span
              v-else
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-canvas-inset text-[10px] font-semibold text-ink-muted"
            >
              {{ c.login.slice(0, 1).toUpperCase() }}
            </span>
            <span class="truncate font-medium text-ink">{{ c.login }}</span>
            <span v-if="c.name" class="truncate text-ink-faint">{{ c.name }}</span>
          </div>
        </template>

        <div
          v-if="isLoading && candidates.length === 0"
          class="flex items-center gap-2 px-2 py-2 text-xs text-ink-faint"
        >
          <Loader2 class="h-3 w-3 animate-spin" />
          <span>Searching…</span>
        </div>
        <div
          v-else-if="!isLoading && candidates.length === 0 && query.trim()"
          class="px-2 py-2 text-xs text-ink-faint"
        >
          {{ lookupFailed ? 'Lookup unavailable.' : 'No matching users.' }}
          Press Enter to request
          <span class="font-medium text-ink-secondary">@{{ query.trim().replace(/^@/, '') }}</span>
        </div>
      </div>
    </Teleport>
  </form>
</template>
