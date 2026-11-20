<script setup lang="ts">
import { AlertTriangle, CheckCircle2, FolderGit2, GitBranch, Loader2, RefreshCw, X } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { checkoutKey, localBranchForPR, shortOid, type CheckoutTarget } from '@/services/localCheckout'
import { useCheckoutStore } from '@/stores/checkout'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{
  target: CheckoutTarget
}>()

const checkout = useCheckoutStore()
const settings = useSettingsStore()

const ownerRepo = computed(() => `${props.target.owner}/${props.target.repo}`)
const key = computed(() => checkoutKey(props.target))
const available = checkout.isAvailable()
const linked = computed(() => checkout.isLinked(props.target.owner, props.target.repo))
const localBranch = computed(() => localBranchForPR(props.target))
const status = computed(() => checkout.statusFor(props.target.owner, props.target.repo))
const state = computed(() => checkout.stateFor(props.target))
const statusError = computed(() => checkout.statusErrorByRepo[ownerRepo.value] ?? null)
const isBusy = computed(() => checkout.busyKey === key.value)
const dirtyFiles = computed(() => status.value?.dirtyFiles ?? [])
const error = computed(() => checkout.errorByPR[key.value] ?? null)
const message = computed(() => checkout.messageByPR[key.value] ?? null)

const actionLabel = computed(() => {
  if (state.value?.kind === 'on-pr-stale') return 'Update branch'
  return 'Check out'
})

const showAction = computed(() => linked.value && state.value?.kind !== 'on-pr')

const actionDisabledReason = computed(() => {
  if (checkout.busyKey && !isBusy.value) return 'Another checkout is in progress'
  if (dirtyFiles.value.length > 0) {
    return `Commit or stash uncommitted changes first:\n${dirtyFiles.value.slice(0, 10).join('\n')}`
  }
  return null
})

function refresh() {
  if (available && linked.value) void checkout.refreshStatus(props.target.owner, props.target.repo)
}

function runCheckout() {
  void checkout.checkout(props.target)
}

function linkCheckout() {
  settings.openSettings('repositories', { linkRepo: ownerRepo.value })
}

// The user may switch branches in a terminal while Stroll is in the background.
function onWindowFocus() {
  if (!checkout.busyKey) refresh()
}

watch([ownerRepo, () => checkout.repoPathFor(props.target.owner, props.target.repo)], refresh, {
  immediate: true,
})

onMounted(() => window.addEventListener('focus', onWindowFocus))
onBeforeUnmount(() => window.removeEventListener('focus', onWindowFocus))
</script>

<template>
  <div v-if="available" class="flex flex-col gap-1 text-[11px]">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <!-- Not linked: point at Settings -->
      <button
        v-if="!linked"
        type="button"
        class="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-0.5 text-ink-muted transition-colors hover:border-terra-border hover:text-terra-text"
        :title="`Link a local checkout of ${ownerRepo} to check out this branch`"
        @click="linkCheckout"
      >
        <FolderGit2 class="h-3 w-3" />
        <span>Link local checkout to check out this branch</span>
      </button>

      <template v-else>
        <span v-if="statusError" class="inline-flex items-center gap-1 text-crimson-text" :title="statusError">
          <AlertTriangle class="h-3 w-3" />
          <span>Linked checkout unavailable</span>
        </span>
        <span v-else-if="!state" class="inline-flex items-center gap-1 text-ink-faint">
          <Loader2 class="h-3 w-3 animate-spin" />
          <span>Reading local checkout…</span>
        </span>
        <span v-else-if="state.kind === 'on-pr'" class="inline-flex items-center gap-1 text-pine-text">
          <CheckCircle2 class="h-3 w-3" />
          <span>
            Checked out locally: <span class="font-mono">{{ state.branch }}</span>
            <span v-if="status?.headOid" class="font-mono text-ink-faint"> @ {{ shortOid(status.headOid) }}</span>
          </span>
        </span>
        <span v-else-if="state.kind === 'on-pr-stale'" class="inline-flex items-center gap-1 text-ochre-text">
          <AlertTriangle class="h-3 w-3" />
          <span>
            Local <span class="font-mono">{{ state.branch }}</span> is at
            <span class="font-mono">{{ shortOid(status?.headOid) }}</span>, PR head is
            <span class="font-mono">{{ shortOid(target.headRefOid) }}</span>
          </span>
        </span>
        <span v-else class="inline-flex items-center gap-1 text-ink-muted">
          <GitBranch class="h-3 w-3 text-ink-faint" />
          <span>
            Local checkout is on
            <span class="font-mono text-ink-secondary">{{ state.branch ?? 'a detached HEAD' }}</span>
          </span>
        </span>

        <span
          v-if="dirtyFiles.length > 0 && state?.kind !== 'on-pr'"
          class="text-ochre-text"
          :title="dirtyFiles.join('\n')"
        >
          · {{ dirtyFiles.length }} uncommitted change{{ dirtyFiles.length === 1 ? '' : 's' }}
        </span>

        <button
          v-if="showAction"
          type="button"
          class="inline-flex items-center gap-1 rounded-md border border-terra-border bg-terra-soft px-2 py-0.5 font-semibold text-terra-text transition-colors hover:bg-terra/20 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="isBusy || !!actionDisabledReason"
          :title="actionDisabledReason ?? `Fetch and switch the linked checkout to ${localBranch}`"
          @click="runCheckout"
        >
          <Loader2 v-if="isBusy" class="h-3 w-3 animate-spin" />
          <GitBranch v-else class="h-3 w-3" />
          <span>{{ isBusy ? 'Checking out…' : actionLabel }}</span>
          <span v-if="!isBusy && state?.kind !== 'on-pr-stale'" class="font-mono font-normal">{{ localBranch }}</span>
        </button>

        <button
          type="button"
          class="rounded p-0.5 text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
          title="Re-read local checkout status"
          :disabled="isBusy"
          @click="refresh"
        >
          <RefreshCw class="h-3 w-3" />
        </button>
      </template>
    </div>

    <div
      v-if="error || message"
      class="flex items-start gap-1.5 rounded-md border px-2 py-1"
      :class="error ? 'border-crimson-border bg-crimson-soft text-crimson-text' : 'border-pine-border bg-pine-soft text-pine-text'"
    >
      <span class="min-w-0 flex-1 whitespace-pre-line break-words">{{ error ?? message }}</span>
      <button type="button" class="shrink-0 opacity-70 hover:opacity-100" title="Dismiss" @click="checkout.dismiss(target)">
        <X class="h-3 w-3" />
      </button>
    </div>
  </div>
</template>
