<script setup lang="ts">
import { getVersion } from '@tauri-apps/api/app'
import { CheckCircle2, Download, KeyRound, Loader2, LogOut, RefreshCw, X } from '@lucide/vue'
import { onMounted, ref, watch } from 'vue'
import { checkForAppUpdate, type AvailableUpdate } from '@/services/updater'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const tokenInput = ref(auth.pat)
const appVersion = ref('0.1.0')
const updateState = ref<'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'error'>('idle')
const availableUpdate = ref<AvailableUpdate | null>(null)
const updateMessage = ref('')

onMounted(async () => {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      appVersion.value = await getVersion()
    } catch {
      // Fallback to default version
    }
  }
})

async function handleCheckForUpdates() {
  updateState.value = 'checking'
  updateMessage.value = ''
  availableUpdate.value = null
  try {
    const result = await checkForAppUpdate()
    if (result.available) {
      availableUpdate.value = result
      updateState.value = 'available'
    } else {
      updateState.value = 'up-to-date'
    }
  } catch (err) {
    updateState.value = 'error'
    updateMessage.value = err instanceof Error ? err.message : 'Unable to check for updates.'
  }
}

async function handleInstallUpdate() {
  if (!availableUpdate.value) return
  updateState.value = 'installing'
  updateMessage.value = 'Downloading update...'
  try {
    await availableUpdate.value.install((downloaded, total) => {
      if (total && total > 0) {
        const pct = Math.round((downloaded / total) * 100)
        updateMessage.value = `Downloading update (${pct}%)...`
      }
    })
  } catch (err) {
    updateState.value = 'error'
    updateMessage.value = err instanceof Error ? err.message : 'Failed to install update.'
  }
}

watch(
  () => auth.showSettingsModal,
  (open) => {
    if (open) tokenInput.value = auth.pat
  },
)

async function handleSave() {
  if (!tokenInput.value.trim()) return
  const ok = await auth.verifyAndLoadProfile(tokenInput.value.trim())
  if (ok) {
    auth.showSettingsModal = false
  }
}
</script>

<template>
  <Transition name="modal-pop">
    <div
      v-if="auth.showSettingsModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      @click.self="auth.showSettingsModal = false"
    >
    <div class="w-full max-w-md rounded-xl border border-border bg-canvas-subtle shadow-2xl">
      <div class="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div class="flex items-center gap-2">
          <KeyRound class="h-4 w-4 text-blue-400" />
          <h2 class="text-sm font-semibold text-slate-100">GitHub Authentication</h2>
        </div>
        <button
          class="rounded p-1 text-slate-400 hover:bg-canvas-elevated hover:text-slate-100"
          @click="auth.showSettingsModal = false"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="space-y-4 p-5">
        <p class="text-xs leading-relaxed text-slate-400">
          Enter a GitHub Personal Access Token (PAT) with <code class="text-slate-200">repo</code>
          and <code class="text-slate-200">read:user</code> scopes. Stored securely on your machine
          via Tauri Store.
        </p>

        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-300">Personal Access Token</label>
          <input
            v-model="tokenInput"
            type="password"
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            class="w-full rounded-lg border border-border bg-canvas-inset px-3 py-2 font-mono text-xs text-slate-100 placeholder-slate-600 focus:border-blue-500 focus:outline-none"
            @keydown.enter="handleSave"
          />
        </div>

        <div
          v-if="auth.error"
          class="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
        >
          {{ auth.error }}
        </div>

        <div
          v-if="auth.viewer"
          class="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
        >
          <span class="flex items-center gap-2">
            <CheckCircle2 class="h-4 w-4" />
            Signed in as <strong class="font-mono">@{{ auth.viewer.login }}</strong>
          </span>
          <button
            class="inline-flex items-center gap-1 text-slate-400 hover:text-rose-300"
            @click="auth.clearPat()"
          >
            <LogOut class="h-3.5 w-3.5" />
            <span>Sign out</span>
          </button>
        </div>

        <div class="border-t border-border pt-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-xs font-medium text-slate-300">PR Tour v{{ appVersion }}</p>
              <p v-if="updateState === 'up-to-date'" class="text-[11px] text-emerald-400">
                You're on the latest version.
              </p>
              <p v-else-if="updateState === 'available' && availableUpdate" class="text-[11px] text-blue-400">
                Version v{{ availableUpdate.version }} is available.
              </p>
              <p v-else-if="updateState === 'installing'" class="text-[11px] text-slate-400">
                {{ updateMessage }}
              </p>
              <p v-else-if="updateState === 'error'" class="text-[11px] text-amber-400">
                {{ updateMessage }}
              </p>
            </div>

            <button
              v-if="updateState === 'available'"
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/15 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/25"
              @click="handleInstallUpdate"
            >
              <Download class="h-3.5 w-3.5" />
              <span>Install &amp; Restart</span>
            </button>
            <button
              v-else
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-slate-300 hover:bg-canvas-elevated disabled:opacity-50"
              :disabled="updateState === 'checking' || updateState === 'installing'"
              @click="handleCheckForUpdates"
            >
              <Loader2 v-if="updateState === 'checking' || updateState === 'installing'" class="h-3.5 w-3.5 animate-spin" />
              <RefreshCw v-else class="h-3.5 w-3.5" />
              <span>Check for Updates</span>
            </button>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button
          class="rounded-lg border border-border bg-canvas px-3.5 py-1.5 text-xs text-slate-300 hover:bg-canvas-elevated"
          @click="auth.showSettingsModal = false"
        >
          Cancel
        </button>
        <button
          class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
          :disabled="auth.isLoading || !tokenInput.trim()"
          @click="handleSave"
        >
          <Loader2 v-if="auth.isLoading" class="h-3.5 w-3.5 animate-spin" />
          <span>Verify & Save</span>
        </button>
      </div>
    </div>
    </div>
  </Transition>
</template>
