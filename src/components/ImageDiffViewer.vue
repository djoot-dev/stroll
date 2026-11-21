<script setup lang="ts">
import { Columns2, Contrast, Layers, Loader2, SlidersHorizontal } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { PRFile } from '@/types/pr'

type ImageDiffMode = 'side-by-side' | 'slider' | 'onion' | 'difference'

const props = defineProps<{
  file: PRFile
  baseSrc: string | null
  headSrc: string | null
  isLoading: boolean
  loadError: string | null
  baseDims: { width: number; height: number } | null
  headDims: { width: number; height: number } | null
}>()

const emit = defineEmits<{
  (e: 'base-load', event: Event): void
  (e: 'head-load', event: Event): void
}>()

const mode = ref<ImageDiffMode>('side-by-side')
const sliderPos = ref(50)
const onionOpacity = ref(50)
const sliderFrameRef = ref<HTMLElement | null>(null)
const isDraggingSlider = ref(false)

const canOverlayCompare = computed(
  () =>
    props.file.status !== 'added' &&
    props.file.status !== 'deleted' &&
    Boolean(props.baseSrc) &&
    Boolean(props.headSrc),
)

function updateSliderFromPointer(clientX: number) {
  const el = sliderFrameRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return
  const pct = ((clientX - rect.left) / rect.width) * 100
  sliderPos.value = Math.round(Math.min(100, Math.max(0, pct)))
}

function handleSliderPointerDown(e: PointerEvent) {
  isDraggingSlider.value = true
  ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
  updateSliderFromPointer(e.clientX)
}

function handleSliderPointerMove(e: PointerEvent) {
  if (!isDraggingSlider.value) return
  updateSliderFromPointer(e.clientX)
}

function handleSliderPointerUp() {
  isDraggingSlider.value = false
}
</script>

<template>
  <div class="p-6">
    <div
      v-if="isLoading"
      class="flex items-center justify-center gap-2 py-10 text-xs text-ink-muted"
    >
      <Loader2 class="h-4 w-4 animate-spin text-terra" />
      <span>Loading image preview…</span>
    </div>

    <div
      v-else-if="loadError"
      class="rounded-xl border border-crimson-border bg-crimson-soft p-4 text-center text-xs text-crimson-text"
    >
      {{ loadError }}
    </div>

    <!-- Added Image -->
    <div
      v-else-if="file.status === 'added'"
      class="mx-auto max-w-2xl overflow-hidden rounded-xl border border-pine-border bg-canvas-subtle"
    >
      <div class="flex items-center justify-between border-b border-pine-border bg-pine-soft px-3.5 py-2 text-xs">
        <span class="font-semibold text-pine-text">Added Image</span>
        <span v-if="headDims" class="font-mono text-[11px] text-pine-text">
          {{ headDims.width }} × {{ headDims.height }} px
        </span>
      </div>
      <div class="flex items-center justify-center bg-canvas-inset p-6">
        <img
          v-if="headSrc"
          :src="headSrc"
          :alt="file.path"
          class="max-h-[420px] max-w-full rounded-lg border border-border object-contain shadow-xs"
          @load="emit('head-load', $event)"
        />
        <span v-else class="text-xs text-ink-muted">Image preview unavailable</span>
      </div>
    </div>

    <!-- Deleted Image -->
    <div
      v-else-if="file.status === 'deleted'"
      class="mx-auto max-w-2xl overflow-hidden rounded-xl border border-crimson-border bg-canvas-subtle"
    >
      <div class="flex items-center justify-between border-b border-crimson-border bg-crimson-soft px-3.5 py-2 text-xs">
        <span class="font-semibold text-crimson-text">Deleted Image</span>
        <span v-if="baseDims" class="font-mono text-[11px] text-crimson-text">
          {{ baseDims.width }} × {{ baseDims.height }} px
        </span>
      </div>
      <div class="flex items-center justify-center bg-canvas-inset p-6">
        <img
          v-if="baseSrc"
          :src="baseSrc"
          :alt="file.path"
          class="max-h-[420px] max-w-full rounded-lg border border-crimson-border object-contain opacity-65 shadow-xs"
          @load="emit('base-load', $event)"
        />
        <span v-else class="text-xs text-ink-muted">Image preview unavailable</span>
      </div>
    </div>

    <!-- Modified / Renamed Image -->
    <div v-else class="space-y-4">
      <div v-if="canOverlayCompare" class="flex flex-wrap items-center justify-between gap-3">
        <div class="inline-flex rounded-xl border border-border bg-canvas-subtle p-0.5 text-[11px]">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-colors"
            :class="mode === 'side-by-side' ? 'bg-terra font-semibold text-white' : 'text-ink-muted hover:text-ink'"
            @click="mode = 'side-by-side'"
          >
            <Columns2 class="h-3 w-3" />
            <span>Side-by-Side</span>
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-colors"
            :class="mode === 'slider' ? 'bg-terra font-semibold text-white' : 'text-ink-muted hover:text-ink'"
            @click="mode = 'slider'"
          >
            <SlidersHorizontal class="h-3 w-3" />
            <span>Slider</span>
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-colors"
            :class="mode === 'onion' ? 'bg-terra font-semibold text-white' : 'text-ink-muted hover:text-ink'"
            @click="mode = 'onion'"
          >
            <Layers class="h-3 w-3" />
            <span>Onion-skin</span>
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-colors"
            :class="mode === 'difference' ? 'bg-terra font-semibold text-white' : 'text-ink-muted hover:text-ink'"
            @click="mode = 'difference'"
          >
            <Contrast class="h-3 w-3" />
            <span>Difference</span>
          </button>
        </div>

        <div v-if="baseDims || headDims" class="flex items-center gap-3 font-mono text-[11px] text-ink-muted">
          <span v-if="baseDims" class="text-crimson-text">
            Base: {{ baseDims.width }}×{{ baseDims.height }}
          </span>
          <span v-if="headDims" class="text-pine-text">
            Head: {{ headDims.width }}×{{ headDims.height }}
          </span>
        </div>
      </div>

      <!-- Side-by-Side Mode -->
      <div v-if="mode === 'side-by-side' || !canOverlayCompare" class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div class="overflow-hidden rounded-xl border border-crimson-border bg-canvas-subtle">
          <div class="flex items-center justify-between border-b border-crimson-border bg-crimson-soft px-3.5 py-2 text-xs">
            <span class="font-semibold text-crimson-text">Before (Base)</span>
            <span v-if="baseDims" class="font-mono text-[11px] text-crimson-text">
              {{ baseDims.width }} × {{ baseDims.height }} px
            </span>
          </div>
          <div class="flex min-h-[180px] items-center justify-center bg-canvas-inset p-5">
            <img
              v-if="baseSrc"
              :src="baseSrc"
              :alt="`Base ${file.path}`"
              class="max-h-[360px] max-w-full rounded-lg border border-border object-contain shadow-xs"
              @load="emit('base-load', $event)"
            />
            <span v-else class="text-xs text-ink-muted">Base preview unavailable</span>
          </div>
        </div>

        <div class="overflow-hidden rounded-xl border border-pine-border bg-canvas-subtle">
          <div class="flex items-center justify-between border-b border-pine-border bg-pine-soft px-3.5 py-2 text-xs">
            <span class="font-semibold text-pine-text">After (Head)</span>
            <span v-if="headDims" class="font-mono text-[11px] text-pine-text">
              {{ headDims.width }} × {{ headDims.height }} px
            </span>
          </div>
          <div class="flex min-h-[180px] items-center justify-center bg-canvas-inset p-5">
            <img
              v-if="headSrc"
              :src="headSrc"
              :alt="`Head ${file.path}`"
              class="max-h-[360px] max-w-full rounded-lg border border-border object-contain shadow-xs"
              @load="emit('head-load', $event)"
            />
            <span v-else class="text-xs text-ink-muted">Head preview unavailable</span>
          </div>
        </div>
      </div>

      <!-- Slider (Swipe) Mode -->
      <div
        v-else-if="mode === 'slider'"
        class="overflow-hidden rounded-xl border border-border bg-canvas-subtle"
      >
        <div class="flex items-center justify-between border-b border-border bg-canvas-elevated/60 px-3.5 py-2 text-[11px]">
          <span class="font-semibold text-crimson-text">Before (Left)</span>
          <span class="font-mono text-ink-muted">{{ sliderPos }}%</span>
          <span class="font-semibold text-pine-text">After (Right)</span>
        </div>
        <div class="flex flex-col items-center gap-4 bg-canvas-inset p-5">
          <div
            ref="sliderFrameRef"
            class="relative inline-block cursor-ew-resize select-none overflow-hidden rounded-lg border border-border shadow-xs"
            @pointerdown="handleSliderPointerDown"
            @pointermove="handleSliderPointerMove"
            @pointerup="handleSliderPointerUp"
            @pointercancel="handleSliderPointerUp"
          >
            <img
              :src="baseSrc!"
              :alt="`Base ${file.path}`"
              draggable="false"
              class="block max-h-[420px] max-w-full object-contain"
              @load="emit('base-load', $event)"
            />
            <img
              :src="headSrc!"
              :alt="`Head ${file.path}`"
              draggable="false"
              class="pointer-events-none absolute inset-0 h-full w-full object-contain"
              :style="{ clipPath: `inset(0 0 0 ${sliderPos}%)` }"
              @load="emit('head-load', $event)"
            />
            <div
              class="pointer-events-none absolute inset-y-0 w-0.5 bg-terra shadow-[0_0_6px_rgba(0,0,0,0.45)]"
              :style="{ left: `${sliderPos}%` }"
            >
              <div class="absolute top-1/2 left-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-terra text-[10px] font-bold text-white shadow">
                ⇄
              </div>
            </div>
          </div>

          <div class="flex w-full max-w-md items-center gap-3 text-[11px] text-ink-muted">
            <span>Before</span>
            <input
              v-model.number="sliderPos"
              type="range"
              min="0"
              max="100"
              aria-label="Image comparison slider"
              class="flex-1 accent-terra"
            />
            <span>After</span>
          </div>
        </div>
      </div>

      <!-- Onion-skin Mode -->
      <div
        v-else-if="mode === 'onion'"
        class="overflow-hidden rounded-xl border border-border bg-canvas-subtle"
      >
        <div class="flex items-center justify-between border-b border-border bg-canvas-elevated/60 px-3.5 py-2 text-[11px]">
          <span class="font-semibold text-ink">Onion-skin Overlay</span>
          <span class="font-mono text-ink-muted">Head opacity: {{ onionOpacity }}%</span>
        </div>
        <div class="flex flex-col items-center gap-4 bg-canvas-inset p-5">
          <div class="relative inline-block overflow-hidden rounded-lg border border-border shadow-xs">
            <img
              :src="baseSrc!"
              :alt="`Base ${file.path}`"
              class="block max-h-[420px] max-w-full object-contain"
              @load="emit('base-load', $event)"
            />
            <img
              :src="headSrc!"
              :alt="`Head ${file.path}`"
              class="pointer-events-none absolute inset-0 h-full w-full object-contain"
              :style="{ opacity: onionOpacity / 100 }"
              @load="emit('head-load', $event)"
            />
          </div>

          <div class="flex w-full max-w-md items-center gap-3 text-[11px] text-ink-muted">
            <span>Base (0%)</span>
            <input
              v-model.number="onionOpacity"
              type="range"
              min="0"
              max="100"
              aria-label="Onion-skin opacity"
              class="flex-1 accent-terra"
            />
            <span>Head (100%)</span>
          </div>
        </div>
      </div>

      <!-- Difference Overlay Mode -->
      <div
        v-else
        class="overflow-hidden rounded-xl border border-border bg-canvas-subtle"
      >
        <div class="flex items-center justify-between border-b border-border bg-canvas-elevated/60 px-3.5 py-2 text-[11px]">
          <span class="font-semibold text-ink">Pixel Difference</span>
          <span class="text-ink-muted">Identical pixels appear black; changed pixels highlight</span>
        </div>
        <div class="flex items-center justify-center bg-black p-5">
          <div class="relative inline-block overflow-hidden rounded-lg border border-border/40">
            <img
              :src="baseSrc!"
              :alt="`Base ${file.path}`"
              class="block max-h-[420px] max-w-full object-contain"
              @load="emit('base-load', $event)"
            />
            <img
              :src="headSrc!"
              :alt="`Head ${file.path}`"
              class="pointer-events-none absolute inset-0 h-full w-full object-contain mix-blend-difference"
              @load="emit('head-load', $event)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
