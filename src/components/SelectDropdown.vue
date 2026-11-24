<script setup lang="ts">
import { Check, ChevronDown } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface SelectDropdownOption {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: ReadonlyArray<SelectDropdownOption>
    ariaLabel: string
    disabled?: boolean
    busy?: boolean
    size?: 'sm' | 'xs'
    surface?: 'subtle' | 'canvas'
    align?: 'left' | 'right' | 'responsive-right'
    fullWidth?: boolean
    labelClass?: string
    menuClass?: string
  }>(),
  {
    disabled: false,
    busy: false,
    size: 'sm',
    surface: 'subtle',
    align: 'right',
    fullWidth: false,
    labelClass: '',
    menuClass: '',
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const isOpen = ref(false)
const containerRef = ref<HTMLElement | null>(null)

const activeOption = computed(
  () => props.options.find((opt) => opt.value === props.modelValue) ?? props.options[0],
)

const sizeButtonClasses = computed(() =>
  props.size === 'xs'
    ? 'rounded-lg px-2 py-1 text-[11px] focus:border-terra-border'
    : 'rounded-xl px-2.5 py-1.5 text-xs focus:border-terra',
)

const sizeOptionClasses = computed(() =>
  props.size === 'xs' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs',
)

const menuAlignmentClasses = computed(() => {
  if (props.align === 'left') return 'left-0'
  if (props.align === 'responsive-right') return 'left-0 sm:right-0 sm:left-auto'
  return 'right-0'
})

function toggleMenu() {
  if (props.disabled) return
  isOpen.value = !isOpen.value
}

function selectOption(value: string) {
  isOpen.value = false
  if (value !== props.modelValue) {
    emit('update:modelValue', value)
  }
}

function handlePointerDown(e: PointerEvent) {
  if (!isOpen.value) return
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (!isOpen.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    isOpen.value = false
  }
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) isOpen.value = false
  },
)

onMounted(() => {
  if (typeof window === 'undefined') return
  window.addEventListener('pointerdown', handlePointerDown)
  window.addEventListener('keydown', handleKeydown, true)
})

onBeforeUnmount(() => {
  if (typeof window === 'undefined') return
  window.removeEventListener('pointerdown', handlePointerDown)
  window.removeEventListener('keydown', handleKeydown, true)
})
</script>

<template>
  <div ref="containerRef" class="relative" :class="{ 'min-w-0': fullWidth }">
    <button
      type="button"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      :disabled="disabled"
      :aria-busy="busy || undefined"
      class="inline-flex items-center gap-1.5 border border-border text-ink-secondary transition-colors hover:border-terra-border hover:text-ink focus:outline-none disabled:opacity-50"
      :class="[
        surface === 'canvas' ? 'bg-canvas' : 'bg-canvas-subtle',
        sizeButtonClasses,
        fullWidth ? 'w-full justify-between' : '',
      ]"
      @click="toggleMenu"
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <slot name="leading" />
        <span class="truncate" :class="labelClass">
          {{ activeOption?.label ?? modelValue }}
        </span>
      </span>
      <ChevronDown
        class="h-3 w-3 shrink-0 text-ink-faint transition-transform"
        :class="{ 'rotate-180': isOpen }"
      />
    </button>

    <div
      v-if="isOpen"
      role="listbox"
      :aria-label="ariaLabel"
      class="animate-pop-in stroll-elevated absolute top-full z-20 mt-1.5 max-h-60 min-w-44 overflow-y-auto rounded-xl border border-border bg-canvas-subtle p-1"
      :class="[menuAlignmentClasses, menuClass]"
    >
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        role="option"
        :aria-selected="modelValue === opt.value"
        class="flex w-full items-center justify-between gap-2 rounded-lg text-left transition-colors hover:bg-canvas-elevated"
        :class="[
          sizeOptionClasses,
          modelValue === opt.value ? 'font-semibold text-terra-text' : 'text-ink-secondary',
        ]"
        @click="selectOption(opt.value)"
      >
        <span class="truncate">{{ opt.label }}</span>
        <Check v-if="modelValue === opt.value" class="h-3 w-3 shrink-0" />
      </button>
    </div>
  </div>
</template>
