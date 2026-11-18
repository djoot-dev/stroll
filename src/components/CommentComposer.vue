<script setup lang="ts">
import { ref, onMounted } from 'vue'

const props = defineProps<{
  line: number
  side: 'LEFT' | 'RIGHT'
}>()

const emit = defineEmits<{
  (e: 'submit', body: string): void
  (e: 'cancel'): void
}>()

const body = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

onMounted(() => {
  textareaRef.value?.focus()
})

function handleSubmit() {
  if (!body.value.trim()) return
  emit('submit', body.value.trim())
  body.value = ''
}
</script>

<template>
  <div class="my-1.5 mx-3 rounded-lg border border-blue-500/40 bg-canvas-subtle p-3 shadow-lg">
    <div class="mb-2 flex items-center justify-between text-[11px] text-slate-400">
      <span>
        Add pending comment on line
        <span class="font-mono font-semibold text-blue-300">
          {{ props.side === 'LEFT' ? 'old ' : '' }}{{ props.line }}
        </span>
      </span>
      <span class="text-slate-500">Saved locally until Finish Review</span>
    </div>

    <textarea
      ref="textareaRef"
      v-model="body"
      rows="3"
      placeholder="Write a review comment (Markdown supported)..."
      class="w-full rounded border border-border bg-canvas-inset px-3 py-2 font-sans text-xs text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
      @keydown.meta.enter.prevent="handleSubmit"
      @keydown.ctrl.enter.prevent="handleSubmit"
      @keydown.esc.prevent="emit('cancel')"
    />

    <div class="mt-2 flex items-center justify-end gap-2">
      <button
        class="rounded border border-border bg-canvas px-3 py-1 text-xs text-slate-300 hover:bg-canvas-elevated"
        @click="emit('cancel')"
      >
        Cancel
      </button>
      <button
        class="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
        :disabled="!body.trim()"
        @click="handleSubmit"
      >
        Add Pending Comment
      </button>
    </div>
  </div>
</template>
