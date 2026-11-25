<script setup lang="ts">
import {
  Bold,
  Code,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  SquareCode,
  Strikethrough,
} from '@lucide/vue'
import { computed, nextTick, onMounted, ref } from 'vue'
import { useCommentAutocomplete } from '@/composables/useCommentAutocomplete'
import {
  applyMarkdownFormat,
  computeTextDiff,
  formatPastedLink,
  type MarkdownFormatAction,
} from '@/services/markdownFormat'
import { formatShortcut, isModKey } from '@/services/shortcuts'
import CommentAutocompletePopover from './CommentAutocompletePopover.vue'
import MarkdownContent from './MarkdownContent.vue'

const props = withDefaults(
  defineProps<{
    placeholder?: string
    rows?: number
    minHeightClass?: string
    textareaClass?: string
    previewClass?: string
    originalLines?: string[]
    autofocus?: boolean
    autocomplete?: boolean
    stopEscPropagation?: boolean
  }>(),
  {
    placeholder: '',
    rows: 3,
    minHeightClass: undefined,
    textareaClass: '',
    previewClass: '',
    originalLines: undefined,
    autofocus: false,
    autocomplete: true,
    stopEscPropagation: true,
  },
)

const modelValue = defineModel<string>({ default: '' })
const preview = defineModel<boolean>('preview', { default: false })

const emit = defineEmits<{
  (e: 'submit'): void
  (e: 'cancel'): void
  (e: 'input', value: string): void
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)

const autocompleteCtrl = useCommentAutocomplete(
  textareaRef,
  () => modelValue.value,
  (next) => {
    modelValue.value = next
    emit('input', next)
  },
)

const resolvedMinHeightClass = computed(() => {
  if (props.minHeightClass) return props.minHeightClass
  if (props.rows >= 8) return 'min-h-48'
  if (props.rows >= 5) return 'min-h-32'
  if (props.rows >= 4) return 'min-h-[92px]'
  if (props.rows >= 3) return 'min-h-[76px]'
  return 'min-h-[56px]'
})

function onTextareaInput() {
  emit('input', modelValue.value)
  if (props.autocomplete) {
    autocompleteCtrl.onInputOrCursor()
  }
}

function onTextareaClick() {
  if (props.autocomplete) {
    autocompleteCtrl.onInputOrCursor()
  }
}

async function applyFormatResult(
  text: string,
  selectionStart: number,
  selectionEnd: number,
) {
  const el = textareaRef.value
  if (el && typeof document !== 'undefined' && typeof document.execCommand === 'function') {
    const before = el.value
    if (before !== text) {
      const { start, end, replacement } = computeTextDiff(before, text)
      el.focus()
      el.setSelectionRange(start, end)
      const ok = replacement
        ? document.execCommand('insertText', false, replacement)
        : document.execCommand('delete', false)
      if (ok && el.value === text) {
        el.setSelectionRange(selectionStart, selectionEnd)
        await nextTick()
        el.setSelectionRange(selectionStart, selectionEnd)
        if (props.autocomplete) {
          autocompleteCtrl.onInputOrCursor()
        }
        return
      }
    }
  }

  modelValue.value = text
  emit('input', text)
  await nextTick()
  const updatedEl = textareaRef.value
  if (!updatedEl) return
  updatedEl.focus()
  updatedEl.setSelectionRange(selectionStart, selectionEnd)
  if (props.autocomplete) {
    autocompleteCtrl.onInputOrCursor()
  }
}

function handleFormat(action: MarkdownFormatAction) {
  const el = textareaRef.value
  const current = modelValue.value
  const start = el ? el.selectionStart : current.length
  const end = el ? el.selectionEnd : current.length
  const result = applyMarkdownFormat(current, action, start, end)
  void applyFormatResult(result.text, result.selectionStart, result.selectionEnd)
}

function onTextareaPaste(e: ClipboardEvent) {
  const pastedText = e.clipboardData?.getData('text/plain')
  if (!pastedText) return
  const el = textareaRef.value
  if (!el) return
  const result = formatPastedLink(
    modelValue.value,
    pastedText,
    el.selectionStart,
    el.selectionEnd,
  )
  if (!result) return
  e.preventDefault()
  void applyFormatResult(result.text, result.selectionStart, result.selectionEnd)
}

const FORMAT_SHORTCUTS: Record<string, MarkdownFormatAction> = {
  b: 'bold',
  i: 'italic',
  e: 'code',
  k: 'link',
}

function onTextareaKeydown(e: KeyboardEvent) {
  if (props.autocomplete && autocompleteCtrl.handleKeydown(e)) {
    e.stopPropagation()
    return
  }

  if (!e.shiftKey && !e.altKey && isModKey(e)) {
    const action = FORMAT_SHORTCUTS[e.key.toLowerCase()]
    if (action) {
      e.preventDefault()
      e.stopPropagation()
      handleFormat(action)
    }
  }
}

function onTextareaBlur() {
  if (props.autocomplete) {
    autocompleteCtrl.close()
  }
}

function onSubmitShortcut() {
  if (props.autocomplete && autocompleteCtrl.isOpen.value) return
  emit('submit')
}

function onEscShortcut(e: KeyboardEvent) {
  if (props.autocomplete && autocompleteCtrl.isOpen.value) {
    autocompleteCtrl.close()
    e.stopPropagation()
    e.preventDefault()
    return
  }
  if (props.stopEscPropagation) {
    e.stopPropagation()
  }
  emit('cancel')
}

async function focusWrite(cursor?: number, scrollIntoView = false) {
  preview.value = false
  await nextTick()
  const el = textareaRef.value
  if (!el) return
  el.focus()
  const pos = cursor ?? el.value.length
  el.setSelectionRange(pos, pos)
  if (scrollIntoView) {
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

function getSelectionRange(): { start?: number; end?: number } {
  const el = textareaRef.value
  if (preview.value || !el) return {}
  return { start: el.selectionStart, end: el.selectionEnd }
}

onMounted(() => {
  if (props.autofocus) {
    void focusWrite()
  }
})

defineExpose({
  focusWrite,
  getSelectionRange,
  textareaRef,
})
</script>

<template>
  <div
    class="space-y-2"
    @keydown.meta.enter.prevent="onSubmitShortcut"
    @keydown.ctrl.enter.prevent="onSubmitShortcut"
    @keydown.esc="onEscShortcut"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <slot name="header-left" />
        <div
          class="inline-flex rounded-md border border-border bg-canvas p-0.5 text-[10px]"
          role="tablist"
          aria-label="Editor mode"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="!preview"
            class="rounded px-1.5 py-0.5 transition-colors"
            :class="!preview ? 'bg-canvas-elevated font-semibold text-ink' : 'text-ink-muted hover:text-ink'"
            @click="preview = false"
          >
            Write
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="preview"
            class="rounded px-1.5 py-0.5 transition-colors"
            :class="preview ? 'bg-canvas-elevated font-semibold text-ink' : 'text-ink-muted hover:text-ink'"
            @click="preview = true"
          >
            Preview
          </button>
        </div>
        <div
          v-if="!preview"
          class="inline-flex flex-wrap items-center gap-0.5 rounded-md border border-border bg-canvas px-1 py-0.5"
          role="toolbar"
          aria-label="Formatting toolbar"
        >
          <button
            type="button"
            class="rounded p-1 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            :title="`Bold (${formatShortcut('Mod+B')})`"
            aria-label="Bold"
            @click="handleFormat('bold')"
          >
            <Bold class="h-3 w-3" />
          </button>
          <button
            type="button"
            class="rounded p-1 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            :title="`Italic (${formatShortcut('Mod+I')})`"
            aria-label="Italic"
            @click="handleFormat('italic')"
          >
            <Italic class="h-3 w-3" />
          </button>
          <button
            type="button"
            class="rounded p-1 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            title="Strikethrough"
            aria-label="Strikethrough"
            @click="handleFormat('strikethrough')"
          >
            <Strikethrough class="h-3 w-3" />
          </button>
          <span class="mx-0.5 h-3 w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            class="rounded p-1 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            :title="`Inline code (${formatShortcut('Mod+E')})`"
            aria-label="Inline code"
            @click="handleFormat('code')"
          >
            <Code class="h-3 w-3" />
          </button>
          <button
            type="button"
            class="rounded p-1 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            title="Code block"
            aria-label="Code block"
            @click="handleFormat('codeBlock')"
          >
            <SquareCode class="h-3 w-3" />
          </button>
          <button
            type="button"
            class="rounded p-1 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            :title="`Link (${formatShortcut('Mod+K')})`"
            aria-label="Link"
            @click="handleFormat('link')"
          >
            <Link class="h-3 w-3" />
          </button>
          <span class="mx-0.5 h-3 w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            class="rounded p-1 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            title="Quote"
            aria-label="Quote"
            @click="handleFormat('quote')"
          >
            <Quote class="h-3 w-3" />
          </button>
          <button
            type="button"
            class="rounded p-1 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            title="Bulleted list"
            aria-label="Bulleted list"
            @click="handleFormat('bulletList')"
          >
            <List class="h-3 w-3" />
          </button>
          <button
            type="button"
            class="rounded p-1 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            title="Numbered list"
            aria-label="Numbered list"
            @click="handleFormat('numberedList')"
          >
            <ListOrdered class="h-3 w-3" />
          </button>
          <button
            type="button"
            class="rounded p-1 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            title="Task list"
            aria-label="Task list"
            @click="handleFormat('taskList')"
          >
            <ListTodo class="h-3 w-3" />
          </button>
        </div>
        <slot name="header-actions" />
      </div>
      <slot name="header-right" />
    </div>

    <slot name="toolbar" />

    <div
      v-if="preview"
      tabindex="0"
      class="rounded-xl border border-border bg-canvas-inset px-3 py-2 text-xs text-ink-secondary focus:border-terra focus:outline-none"
      :class="[resolvedMinHeightClass, props.previewClass]"
    >
      <MarkdownContent
        v-if="modelValue.trim()"
        :content="modelValue"
        :original-lines="props.originalLines"
      />
      <span v-else class="text-ink-faint">Nothing to preview.</span>
    </div>

    <textarea
      v-else
      ref="textareaRef"
      v-model="modelValue"
      :rows="props.rows"
      :placeholder="props.placeholder"
      class="w-full resize-y rounded-xl border border-border bg-canvas-inset px-3 py-2 text-xs text-ink placeholder:text-ink-faint focus:border-terra-border focus:outline-none"
      :class="[resolvedMinHeightClass, props.textareaClass]"
      @input="onTextareaInput"
      @click="onTextareaClick"
      @paste="onTextareaPaste"
      @keydown="onTextareaKeydown"
      @blur="onTextareaBlur"
    />

    <CommentAutocompletePopover
      v-if="props.autocomplete"
      :open="autocompleteCtrl.isOpen.value"
      :trigger="autocompleteCtrl.trigger.value"
      :options="autocompleteCtrl.options.value"
      :active-index="autocompleteCtrl.activeIndex.value"
      :is-loading="autocompleteCtrl.isLoading.value"
      :coords="autocompleteCtrl.coords.value"
      @select="autocompleteCtrl.selectOption"
      @hover="autocompleteCtrl.activeIndex.value = $event"
    />

    <slot name="footer" />
  </div>
</template>
