<script setup lang="ts">
import {
  Bell,
  Check,
  ChevronDown,
  Command,
  Cpu,
  GitBranch,
  KeyRound,
  MessageSquarePlus,
  Search,
  Server,
  ShieldCheck,
  Terminal,
} from '@lucide/vue'
import { ref } from 'vue'
import { useTheme } from '@/composables/useTheme'

const { isDark, preference, setTheme } = useTheme()
const base = import.meta.env.BASE_URL

const inboxFilter = ref<'requested' | 'mine' | 'all'>('requested')
const diffExpanded = ref(false)
const activeLang = ref<'ts' | 'rust' | 'python' | 'csharp'>('ts')
const reviewVerdict = ref<'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'>('APPROVE')

const INBOX_ITEMS: Record<
  'requested' | 'mine' | 'all',
  Array<{ repo: string; title: string; meta: string; status: string; statusClass: string }>
> = {
  requested: [
    {
      repo: 'acme-cloud/webhook-engine #428',
      title: 'feat: per-endpoint token-bucket rate limiter',
      meta: 'elena-vance · 6 tour steps · 2h ago',
      status: 'Review requested',
      statusClass: 'bg-terra-soft text-terra-text border-terra-border',
    },
    {
      repo: 'acme-cloud/billing-api #194',
      title: 'fix: idempotent invoice retry backoff',
      meta: 'marcus-chen · 4 tour steps · 5h ago',
      status: 'Checks passing',
      statusClass: 'bg-pine-soft text-pine-text border-pine-border',
    },
  ],
  mine: [
    {
      repo: 'djoot-dev/stroll #111',
      title: 'feat: GitHub Pages landing site with shared tokens',
      meta: 'you · 8 tour steps · 14m ago',
      status: '2 checks running',
      statusClass: 'bg-ochre-soft text-ochre-text border-ochre-border',
    },
    {
      repo: 'djoot-dev/stroll #108',
      title: 'refactor: extract Tree-sitter symbol cache',
      meta: 'you · 5 tour steps · 1d ago',
      status: 'Approved',
      statusClass: 'bg-pine-soft text-pine-text border-pine-border',
    },
  ],
  all: [
    {
      repo: 'acme-cloud/webhook-engine #428',
      title: 'feat: per-endpoint token-bucket rate limiter',
      meta: 'elena-vance · 6 tour steps · 2h ago',
      status: 'Review requested',
      statusClass: 'bg-terra-soft text-terra-text border-terra-border',
    },
    {
      repo: 'djoot-dev/stroll #111',
      title: 'feat: GitHub Pages landing site with shared tokens',
      meta: 'you · 8 tour steps · 14m ago',
      status: '2 checks running',
      statusClass: 'bg-ochre-soft text-ochre-text border-ochre-border',
    },
  ],
}

const AST_EXAMPLES = {
  ts: {
    label: 'TypeScript',
    symbol: 'WebhookEndpoint',
    kind: 'interface',
    file: 'src/types/webhook.ts:5',
    blame: 'elena-vance · 2h ago · "feat: add per-endpoint burst limit"',
    signature: 'interface WebhookEndpoint { id: string; maxBurst: number; windowMs: number }',
  },
  rust: {
    label: 'Rust',
    symbol: 'resolve_symbol_at',
    kind: 'fn',
    file: 'src-tauri/src/commands/ast.rs:42',
    blame: 'marcus-chen · 3d ago · "feat: tree-sitter symbol lookup"',
    signature: 'pub fn resolve_symbol_at(source: &str, line: u32, col: u32) -> Option<SymbolDef>',
  },
  python: {
    label: 'Python',
    symbol: 'compute_backoff',
    kind: 'def',
    file: 'workers/retry_policy.py:18',
    blame: 'priya-patel · 1d ago · "fix: cap exponential jitter"',
    signature: 'def compute_backoff(attempt: int, base_ms: int = 250) -> float:',
  },
  csharp: {
    label: 'C#',
    symbol: 'DispatchResult',
    kind: 'record',
    file: 'Webhooks/DispatchResult.cs:11',
    blame: 'daniel-k · 5d ago · "refactor: immutable dispatch status"',
    signature: 'public sealed record DispatchResult(bool Delivered, int StatusCode, TimeSpan Latency);',
  },
}
</script>

<template>
  <section id="features" class="relative py-16 sm:py-24">
    <!-- Winding terracotta footpath spine (desktop) -->
    <div
      aria-hidden="true"
      class="footpath-track pointer-events-none absolute inset-y-12 left-1/2 z-0 hidden -translate-x-1/2 lg:block"
    >
      <svg
        width="176"
        height="100%"
        viewBox="0 0 176 1600"
        preserveAspectRatio="none"
        fill="none"
        class="h-full w-44 opacity-45"
      >
        <path
          d="M88 0 C156 180, 20 360, 88 540 C156 720, 20 900, 88 1080 C156 1260, 20 1440, 88 1600"
          stroke="var(--stroll-terra)"
          stroke-width="4"
          stroke-linecap="round"
          class="footpath-dash"
        />
      </svg>
    </div>

    <div class="relative z-10 mx-auto max-w-6xl space-y-20 px-4 sm:space-y-28 sm:px-6">
      <!-- 1. PR Inbox & Overview -->
      <div class="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
        <div class="min-w-0 lg:col-span-5">
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-sage-border bg-sage-soft px-3 py-1 text-xs font-medium text-sage-text"
          >
            <Bell class="h-3.5 w-3.5" />
            PR Inbox &amp; Overview
          </span>
          <h3 class="mt-3 text-2xl font-bold tracking-tight text-ink">
            Your review queue and full PR context in one calm view.
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-ink-secondary sm:text-base">
            Filter open PRs by <strong>Review Requested</strong>, <strong>My PRs</strong>,
            or <strong>All Involved</strong> with optional auto-refresh and
            desktop notifications — or paste any GitHub PR URL to jump straight in.
          </p>
          <p class="mt-2.5 text-sm leading-relaxed text-ink-secondary sm:text-base">
            The dedicated Overview tab surfaces the PR description, CI checks,
            commits, labels, reviewers, and conversation before you step into code.
          </p>

          <div class="mt-5 flex flex-wrap gap-1.5">
            <button
              v-for="tab in [
                { id: 'requested', label: 'Review Requested (4)' },
                { id: 'mine', label: 'My PRs (2)' },
                { id: 'all', label: 'All Involved (9)' },
              ] as const"
              :key="tab.id"
              type="button"
              class="rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
              :class="
                inboxFilter === tab.id
                  ? 'border-terra-border bg-terra-soft text-terra-text'
                  : 'border-border bg-canvas-subtle text-ink-muted hover:text-ink'
              "
              @click="inboxFilter = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>

          <div
            class="mt-3 space-y-2 rounded-xl border border-border-muted bg-canvas-subtle p-2.5 shadow-card"
            aria-live="polite"
          >
            <div
              v-for="pr in INBOX_ITEMS[inboxFilter]"
              :key="pr.repo"
              class="flex items-start justify-between gap-2 rounded-lg border border-border-muted bg-canvas px-3 py-2"
            >
              <div class="min-w-0">
                <div class="truncate font-mono text-[11px] text-ink-muted">
                  {{ pr.repo }}
                </div>
                <div class="truncate text-xs font-medium text-ink">
                  {{ pr.title }}
                </div>
                <div class="mt-0.5 truncate text-[11px] text-ink-muted">
                  {{ pr.meta }}
                </div>
              </div>
              <span
                class="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium"
                :class="pr.statusClass"
              >
                {{ pr.status }}
              </span>
            </div>
          </div>
        </div>

        <div class="min-w-0 lg:col-span-7">
          <div class="overflow-hidden rounded-2xl border border-border bg-canvas-subtle shadow-card">
            <img
              :src="isDark ? `${base}screenshots/overview-dark.png` : `${base}screenshots/overview-light.png`"
              width="1024"
              height="633"
              alt="Stroll PR Overview showing PR status badges, description, checks, reviewers, and commits"
              class="block h-auto w-full object-cover"
              loading="lazy"
            />
          </div>
        </div>
      </div>

      <!-- 2. Single-File Diff Viewer & Referenced PR Context -->
      <div class="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
        <div class="order-2 min-w-0 lg:order-1 lg:col-span-7">
          <div class="overflow-hidden rounded-2xl border border-border bg-code shadow-card">
            <!-- Diff viewer header + Cmd+F bar -->
            <div
              class="flex flex-wrap items-center justify-between gap-2 border-b border-border-muted bg-canvas-subtle px-4 py-2.5"
            >
              <span class="truncate font-mono text-xs font-medium text-ink">
                src/services/rateLimiter.ts
              </span>
              <div
                class="inline-flex items-center gap-1.5 rounded-md border border-border bg-canvas px-2 py-1 text-[11px] text-ink-muted"
              >
                <Search class="h-3 w-3" />
                <span class="font-mono">canConsume</span>
                <span class="rounded bg-canvas-inset px-1 font-mono text-[10px]">⌘F</span>
              </div>
            </div>

            <!-- Referenced PR Context card -->
            <div class="border-b border-border-muted bg-canvas-subtle/60 p-3">
              <div class="rounded-xl border border-plum-border bg-plum-soft p-3">
                <div class="flex items-center justify-between gap-2 text-xs">
                  <span class="font-semibold text-plum-text">
                    Referenced PR Context · src/types/webhook.ts
                  </span>
                  <span class="font-mono text-[11px] text-ink-muted">Step 2</span>
                </div>
                <pre class="mt-1.5 overflow-x-auto font-mono text-xs text-ink">interface WebhookEndpoint { id: string; maxBurst: number; windowMs: number }</pre>
              </div>
            </div>

            <!-- Collapsible gap + diff lines -->
            <div class="font-mono text-xs leading-6">
              <button
                type="button"
                class="flex w-full items-center gap-2 border-b border-border-muted bg-sage-soft/50 px-4 py-1 text-left text-[11px] font-medium text-sage-text hover:bg-sage-soft"
                @click="diffExpanded = !diffExpanded"
              >
                <ChevronDown
                  class="h-3.5 w-3.5 transition-transform"
                  :class="diffExpanded ? 'rotate-180' : ''"
                />
                <span>
                  {{ diffExpanded ? 'Collapse 3 unchanged lines' : 'Expand 14 unchanged lines' }}
                </span>
              </button>

              <div v-if="diffExpanded" class="bg-code px-4 py-1 text-ink-muted">
                <div> 8 &nbsp; export class EndpointRateLimiter {</div>
                <div> 9 &nbsp; &nbsp; private readonly buckets = new Map&lt;string, BucketState&gt;()</div>
                <div>10 &nbsp;</div>
              </div>

              <div class="border-l-2 border-diff-del-border bg-diff-del px-4 py-0.5 text-diff-del-text">
                - &nbsp; if (bucket.tokens &lt;= 0) return false
              </div>
              <div class="border-l-2 border-diff-add-border bg-diff-add px-4 py-0.5 text-diff-add-text">
                + &nbsp; if (bucket.tokens &lt; cost || cost &gt; endpoint.maxBurst) return false
              </div>
              <div class="border-l-2 border-diff-add-border bg-diff-add px-4 py-0.5 text-diff-add-text">
                + &nbsp; bucket.tokens -= cost
              </div>
              <div class="px-4 py-0.5 text-ink-secondary">
                &nbsp; &nbsp; return true
              </div>
            </div>
          </div>
        </div>

        <div class="order-1 min-w-0 lg:order-2 lg:col-span-5">
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-plum-border bg-plum-soft px-3 py-1 text-xs font-medium text-plum-text"
          >
            Single-File Diff Viewer
          </span>
          <h3 class="mt-3 text-2xl font-bold tracking-tight text-ink">
            One focused file, with upstream changes pinned inline.
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-ink-secondary sm:text-base">
            Powered by CodeMirror 6 with warm light and deep-pine dark syntax
            themes, collapsible unchanged context gaps, and instant in-diff search
            (<code class="font-mono text-xs">Cmd/Ctrl + F</code>).
          </p>
          <p class="mt-2.5 text-sm leading-relaxed text-ink-secondary sm:text-base">
            When a file imports a type or helper modified earlier in the PR,
            <strong>Referenced PR Context</strong> cards show its updated
            definition right above the diff so you never lose your place.
          </p>
        </div>
      </div>

      <!-- 3. Local Repo & AST Code Intelligence -->
      <div class="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
        <div class="min-w-0 lg:col-span-5">
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-terra-border bg-terra-soft px-3 py-1 text-xs font-medium text-terra-text"
          >
            <Cpu class="h-3.5 w-3.5" />
            Local Repo &amp; AST Intelligence
          </span>
          <h3 class="mt-3 text-2xl font-bold tracking-tight text-ink">
            Tree-sitter symbols and <code class="font-mono text-xl">git blame</code> on hover.
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-ink-secondary sm:text-base">
            Link a local Git checkout in Settings to unlock native Rust
            Tree-sitter symbol resolution across TypeScript, JavaScript, Rust,
            Python, and C# — plus <code class="font-mono text-xs">git blame</code>
            author and commit context directly inside code hover popovers.
          </p>

          <div class="mt-5 flex flex-wrap gap-1.5">
            <button
              v-for="(item, key) in AST_EXAMPLES"
              :key="key"
              type="button"
              class="rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
              :class="
                activeLang === key
                  ? 'border-terra-border bg-terra-soft text-terra-text'
                  : 'border-border bg-canvas-subtle text-ink-muted hover:text-ink'
              "
              @click="activeLang = key"
            >
              {{ item.label }}
            </button>
          </div>
        </div>

        <div class="min-w-0 lg:col-span-7">
          <div class="rounded-2xl border border-border bg-canvas-subtle p-5 shadow-card">
            <div class="flex items-center justify-between gap-2 text-xs text-ink-muted">
              <span class="font-mono">Hover Popover · {{ AST_EXAMPLES[activeLang].label }}</span>
              <span class="inline-flex items-center gap-1 rounded bg-pine-soft px-2 py-0.5 font-mono text-[11px] text-pine-text">
                <GitBranch class="h-3 w-3" />
                Local AST + git blame
              </span>
            </div>

            <div class="mt-3 rounded-xl border border-border bg-code p-4 shadow-elevated">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-plum-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold text-plum-text">
                    {{ AST_EXAMPLES[activeLang].kind }}
                  </span>
                  <span class="font-mono text-sm font-semibold text-ink">
                    {{ AST_EXAMPLES[activeLang].symbol }}
                  </span>
                </div>
                <span class="font-mono text-xs text-ink-muted">
                  {{ AST_EXAMPLES[activeLang].file }}
                </span>
              </div>

              <pre class="mt-3 overflow-x-auto rounded-lg border border-border-muted bg-canvas-inset px-3 py-2 font-mono text-xs text-ink">{{ AST_EXAMPLES[activeLang].signature }}</pre>

              <div class="mt-3 flex items-center gap-2 border-t border-border-muted pt-2.5 text-xs text-ink-secondary">
                <span class="font-medium text-terra-text">git blame:</span>
                <span class="truncate font-mono text-[11px]">{{ AST_EXAMPLES[activeLang].blame }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. End-to-End GitHub Review Flow -->
      <div class="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
        <div class="order-2 min-w-0 lg:order-1 lg:col-span-7">
          <div class="rounded-2xl border border-border bg-canvas-subtle p-5 shadow-card">
            <!-- Inline thread preview -->
            <div class="rounded-xl border border-border-muted bg-canvas p-4">
              <div class="flex items-center justify-between text-xs">
                <span class="font-semibold text-ink">@marcus-chen · Line 16</span>
                <span class="rounded bg-ochre-soft px-2 py-0.5 text-[11px] font-medium text-ochre-text">
                  Draft reply saved locally
                </span>
              </div>
              <p class="mt-1.5 text-xs leading-relaxed text-ink-secondary">
                Should we emit a metric when <code class="font-mono">cost &gt; endpoint.maxBurst</code> rejects a burst?
              </p>
              <div class="mt-2.5 flex flex-wrap items-center gap-2">
                <span class="rounded-full border border-border bg-canvas-subtle px-2 py-0.5 text-[11px] text-ink-secondary">
                  🚀 2
                </span>
                <span class="rounded-full border border-border bg-canvas-subtle px-2 py-0.5 text-[11px] text-ink-secondary">
                  👍 1
                </span>
              </div>
            </div>

            <!-- Submit review bar -->
            <div class="mt-4 rounded-xl border border-border bg-canvas p-4">
              <div class="flex items-center justify-between gap-2 text-xs font-medium text-ink">
                <span class="inline-flex items-center gap-1.5">
                  <MessageSquarePlus class="h-4 w-4 text-terra-text" />
                  Finish Review (R)
                </span>
                <span class="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                  <Server class="h-3 w-3" />
                  github.com &amp; GitHub Enterprise
                </span>
              </div>

              <div class="mt-3 grid grid-cols-3 gap-2">
                <button
                  v-for="v in [
                    { id: 'APPROVE', label: 'Approve' },
                    { id: 'REQUEST_CHANGES', label: 'Request Changes' },
                    { id: 'COMMENT', label: 'Comment' },
                  ] as const"
                  :key="v.id"
                  type="button"
                  class="rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors"
                  :class="
                    reviewVerdict === v.id
                      ? v.id === 'APPROVE'
                        ? 'border-pine-border bg-pine-soft text-pine-text'
                        : v.id === 'REQUEST_CHANGES'
                          ? 'border-crimson-border bg-crimson-soft text-crimson-text'
                          : 'border-terra-border bg-terra-soft text-terra-text'
                      : 'border-border bg-canvas-subtle text-ink-muted hover:text-ink'
                  "
                  @click="reviewVerdict = v.id"
                >
                  {{ v.label }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="order-1 min-w-0 lg:order-2 lg:col-span-5">
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-pine-border bg-pine-soft px-3 py-1 text-xs font-medium text-pine-text"
          >
            End-to-End GitHub Review Flow
          </span>
          <h3 class="mt-3 text-2xl font-bold tracking-tight text-ink">
            Draft inline comments, react, and submit without leaving Stroll.
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-ink-secondary sm:text-base">
            Add inline draft comments persisted locally while you walk the tour,
            reply to or edit existing threads, add emoji reactions, and submit
            <code class="font-mono text-xs">APPROVE</code>,
            <code class="font-mono text-xs">REQUEST_CHANGES</code>, or
            <code class="font-mono text-xs">COMMENT</code> reviews directly via
            GitHub GraphQL — including custom GitHub Enterprise hosts.
          </p>
        </div>
      </div>

      <!-- 5. Command Palette & Themes -->
      <div class="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
        <div class="min-w-0 lg:col-span-5">
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-ochre-border bg-ochre-soft px-3 py-1 text-xs font-medium text-ochre-text"
          >
            <Command class="h-3.5 w-3.5" />
            Command Palette &amp; Themes
          </span>
          <h3 class="mt-3 text-2xl font-bold tracking-tight text-ink">
            Jump anywhere with <code class="font-mono text-xl">Cmd/Ctrl + K</code>.
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-ink-secondary sm:text-base">
            Search across PR files, line numbers, symbols, review threads, and
            actions in milliseconds. Switch between Warm Parchment Light, Deep
            Pine Dark, or System themes — try it right here on this page:
          </p>

          <div class="mt-5 inline-flex rounded-xl border border-border bg-canvas-subtle p-1">
            <button
              v-for="t in [
                { id: 'light', label: 'Light' },
                { id: 'dark', label: 'Dark' },
                { id: 'system', label: 'System' },
              ] as const"
              :key="t.id"
              type="button"
              class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              :class="
                preference === t.id
                  ? 'bg-terra text-white shadow-card'
                  : 'text-ink-secondary hover:text-ink'
              "
              @click="setTheme(t.id)"
            >
              {{ t.label }}
            </button>
          </div>
        </div>

        <div class="min-w-0 lg:col-span-7">
          <div class="overflow-hidden rounded-2xl border border-border bg-canvas-subtle shadow-card">
            <img
              :src="`${base}screenshots/command-palette-light.png`"
              width="1024"
              height="633"
              alt="Stroll Command Palette open over the diff viewer, listing PR Overview, tour steps, and quick actions"
              class="block h-auto w-full object-cover"
              loading="lazy"
            />
          </div>
        </div>
      </div>

      <!-- 6. Authentication & Offline Demo Mode -->
      <div class="rounded-2xl border border-border bg-canvas-subtle p-6 shadow-card sm:p-8">
        <div class="max-w-2xl">
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-pine-border bg-pine-soft px-3 py-1 text-xs font-medium text-pine-text"
          >
            <ShieldCheck class="h-3.5 w-3.5" />
            Flexible Authentication &amp; Demo Mode
          </span>
          <h3 class="mt-3 text-2xl font-bold tracking-tight text-ink">
            Zero-friction sign-in, or explore offline immediately.
          </h3>
        </div>

        <div class="mt-6 grid gap-4 md:grid-cols-3">
          <div class="rounded-xl border border-border-muted bg-canvas p-4">
            <div class="flex items-center gap-2 text-sm font-semibold text-ink">
              <Terminal class="h-4 w-4 text-terra-text" />
              <span>GitHub CLI (<code class="font-mono text-xs">gh</code>)</span>
            </div>
            <p class="mt-2 text-xs leading-relaxed text-ink-secondary">
              One-click sign-in that reuses your existing
              <code class="font-mono">gh auth</code> session automatically.
            </p>
          </div>

          <div class="rounded-xl border border-border-muted bg-canvas p-4">
            <div class="flex items-center gap-2 text-sm font-semibold text-ink">
              <KeyRound class="h-4 w-4 text-pine-text" />
              <span>OS Keychain PAT</span>
            </div>
            <p class="mt-2 text-xs leading-relaxed text-ink-secondary">
              Prefer a Personal Access Token? Stroll stores it securely in your
              macOS, Windows, or Linux OS keychain — never in plain text.
            </p>
          </div>

          <div class="rounded-xl border border-border-muted bg-canvas p-4">
            <div class="flex items-center gap-2 text-sm font-semibold text-ink">
              <Check class="h-4 w-4 text-ochre-text" />
              <span>Offline Demo PR</span>
            </div>
            <p class="mt-2 text-xs leading-relaxed text-ink-secondary">
              No credentials needed to try Stroll. Launch the built-in 6-file
              demo PR on startup to test the tour, diffs, and shortcuts.
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
