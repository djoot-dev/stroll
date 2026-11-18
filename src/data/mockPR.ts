import type { PullRequestData } from '@/types/pr'

const MIGRATION_HEAD = `-- Migration: add webhook_deliveries table for retryable delivery tracking
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry
  ON webhook_deliveries (status, next_retry_at)
  WHERE status IN ('pending', 'retrying');`

const TYPES_BASE = `export interface WebhookEndpoint {
  id: string
  url: string
  secret: string
  enabled: boolean
}

export interface WebhookEventPayload {
  id: string
  type: string
  createdAt: string
  data: Record<string, unknown>
}`

const TYPES_HEAD = `export interface WebhookEndpoint {
  id: string
  url: string
  secret: string
  enabled: boolean
  maxRequestsPerMinute: number
}

export type DeliveryStatus = 'pending' | 'retrying' | 'delivered' | 'failed'

export interface RetryPolicy {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

export interface WebhookDeliveryResult {
  deliveryId: string
  status: DeliveryStatus
  attemptCount: number
  nextRetryAt: string | null
  errorMessage?: string
}

export interface WebhookEventPayload {
  id: string
  type: string
  createdAt: string
  data: Record<string, unknown>
}`

const RATE_LIMITER_HEAD = `import type { WebhookEndpoint } from '../types/webhook'

interface BucketState {
  tokens: number
  lastRefillMs: number
}

/**
 * Simple in-memory token bucket rate limiter keyed by webhook endpoint ID.
 */
export class EndpointRateLimiter {
  private buckets = new Map<string, BucketState>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  canConsume(endpoint: WebhookEndpoint): boolean {
    const capacity = Math.max(1, endpoint.maxRequestsPerMinute)
    const refillPerMs = capacity / 60_000
    const currentNow = this.now()

    const existing = this.buckets.get(endpoint.id) ?? {
      tokens: capacity,
      lastRefillMs: currentNow,
    }

    const elapsed = Math.max(0, currentNow - existing.lastRefillMs)
    const refilled = Math.min(capacity, existing.tokens + elapsed * refillPerMs)

    if (refilled < 1) {
      this.buckets.set(endpoint.id, { tokens: refilled, lastRefillMs: currentNow })
      return false
    }

    this.buckets.set(endpoint.id, { tokens: refilled - 1, lastRefillMs: currentNow })
    return true
  }

  reset(endpointId: string): void {
    this.buckets.delete(endpointId)
  }
}`

const DISPATCHER_BASE = `import type { WebhookEndpoint, WebhookEventPayload } from '../types/webhook'

export class WebhookDispatcher {
  async dispatch(endpoint: WebhookEndpoint, event: WebhookEventPayload): Promise<boolean> {
    if (!endpoint.enabled) return false

    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Event': event.type,
      },
      body: JSON.stringify(event),
    })

    return res.ok
  }
}`

const DISPATCHER_HEAD = `import type {
  RetryPolicy,
  WebhookDeliveryResult,
  WebhookEndpoint,
  WebhookEventPayload,
} from '../types/webhook'
import { EndpointRateLimiter } from './rateLimiter'

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
}

export function computeBackoffMs(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  const exp = policy.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1))
  return Math.min(policy.maxDelayMs, exp)
}

export class WebhookDispatcher {
  constructor(
    private readonly rateLimiter: EndpointRateLimiter = new EndpointRateLimiter(),
    private readonly policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ) {}

  async dispatch(
    endpoint: WebhookEndpoint,
    event: WebhookEventPayload,
    attempt = 1,
  ): Promise<WebhookDeliveryResult> {
    const deliveryId = \`del_\${event.id}_\${attempt}\`
    if (!endpoint.enabled) {
      return { deliveryId, status: 'failed', attemptCount: attempt, nextRetryAt: null }
    }

    if (!this.rateLimiter.canConsume(endpoint)) {
      const delayMs = computeBackoffMs(attempt, this.policy)
      return {
        deliveryId,
        status: 'retrying',
        attemptCount: attempt,
        nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
        errorMessage: 'Rate limit exceeded for endpoint',
      }
    }

    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Event': event.type,
      },
      body: JSON.stringify(event),
    })

    if (res.ok) {
      return { deliveryId, status: 'delivered', attemptCount: attempt, nextRetryAt: null }
    }

    const canRetry = attempt < this.policy.maxAttempts
    return {
      deliveryId,
      status: canRetry ? 'retrying' : 'failed',
      attemptCount: attempt,
      nextRetryAt: canRetry
        ? new Date(Date.now() + computeBackoffMs(attempt, this.policy)).toISOString()
        : null,
      errorMessage: \`HTTP \${res.status}\`,
    }
  }
}`

const DISPATCHER_TEST_HEAD = `import { describe, expect, it } from 'vitest'
import { EndpointRateLimiter } from '../services/rateLimiter'
import { computeBackoffMs, WebhookDispatcher } from '../services/webhookDispatcher'
import type { WebhookEndpoint } from '../types/webhook'

const baseEndpoint: WebhookEndpoint = {
  id: 'ep_1',
  url: 'https://example.com/hook',
  secret: 'sec_123',
  enabled: true,
  maxRequestsPerMinute: 2,
}

describe('WebhookDispatcher', () => {
  it('computes capped exponential backoff', () => {
    expect(computeBackoffMs(1)).toBe(1000)
    expect(computeBackoffMs(3)).toBe(4000)
    expect(computeBackoffMs(10)).toBe(60000)
  })

  it('queues retry when endpoint rate limit is exhausted', async () => {
    let clock = 1_000_000
    const limiter = new EndpointRateLimiter(() => clock)
    const dispatcher = new WebhookDispatcher(limiter)

    expect(limiter.canConsume(baseEndpoint)).toBe(true)
    expect(limiter.canConsume(baseEndpoint)).toBe(true)

    const result = await dispatcher.dispatch(baseEndpoint, {
      id: 'evt_1',
      type: 'invoice.paid',
      createdAt: new Date(clock).toISOString(),
      data: {},
    })

    expect(result.status).toBe('retrying')
    expect(result.nextRetryAt).not.toBeNull()
  })
})`

const SETTINGS_VUE_BASE = `<script setup lang="ts">
import type { WebhookEndpoint } from '../types/webhook'

const props = defineProps<{
  endpoint: WebhookEndpoint
}>()
</script>

<template>
  <div class="rounded border border-slate-700 p-4">
    <h3 class="text-sm font-semibold">{{ props.endpoint.url }}</h3>
    <p class="text-xs text-slate-400">Status: {{ props.endpoint.enabled ? 'Active' : 'Paused' }}</p>
  </div>
</template>`

const SETTINGS_VUE_HEAD = `<script setup lang="ts">
import { ref } from 'vue'
import type { WebhookEndpoint } from '../types/webhook'

const props = defineProps<{
  endpoint: WebhookEndpoint
}>()

const emit = defineEmits<{
  (e: 'update:rateLimit', value: number): void
}>()

const rateLimit = ref(props.endpoint.maxRequestsPerMinute)

function saveLimit() {
  emit('update:rateLimit', Math.max(1, rateLimit.value))
}
</script>

<template>
  <div class="rounded border border-slate-700 p-4 space-y-3">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold">{{ props.endpoint.url }}</h3>
      <span class="text-xs text-slate-400">
        {{ props.endpoint.enabled ? 'Active' : 'Paused' }}
      </span>
    </div>
    <label class="flex items-center gap-2 text-xs text-slate-300">
      <span>Max req / min</span>
      <input
        v-model.number="rateLimit"
        type="number"
        min="1"
        class="w-20 rounded bg-slate-900 px-2 py-1 text-xs"
        @change="saveLimit"
      />
    </label>
  </div>
</template>`

export const MOCK_PR: PullRequestData = {
  id: 'PR_mock_428',
  owner: 'acme-cloud',
  repo: 'webhook-engine',
  number: 428,
  title: 'feat: add rate-limited webhook dispatcher with exponential retry queue',
  body: 'Adds per-endpoint token bucket rate limiting, exponential backoff retries, and a delivery tracking migration.',
  url: 'https://github.com/acme-cloud/webhook-engine/pull/428',
  state: 'OPEN',
  author: {
    login: 'elena-rostova',
    avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
  },
  baseRefName: 'main',
  headRefName: 'feat/webhook-rate-limiter',
  baseRefOid: 'a1b2c3d',
  headRefOid: 'e4f5a6b',
  isMock: true,
  pendingReviewId: null,
  commits: [
    {
      oid: 'c111111',
      shortOid: 'c111111',
      messageHeadline: 'db: add webhook_deliveries migration',
      authorName: 'Elena Rostova',
      committedDate: '2026-11-17T14:10:00Z',
    },
    {
      oid: 'e4f5a6b',
      shortOid: 'e4f5a6b',
      messageHeadline: 'feat: add EndpointRateLimiter and retryable WebhookDispatcher',
      authorName: 'Elena Rostova',
      committedDate: '2026-11-18T09:30:00Z',
    },
  ],
  threads: [
    {
      id: 'thread-mock-1',
      path: 'src/services/rateLimiter.ts',
      line: 16,
      side: 'RIGHT',
      isResolved: false,
      isOutdated: false,
      comments: [
        {
          id: 'comment-mock-1',
          author: {
            login: 'marcus-chen',
            avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
          },
          body: 'Should we cap `this.buckets` size or add an LRU eviction if there are thousands of endpoints?',
          createdAt: '2026-11-18T11:15:00Z',
        },
      ],
    },
  ],
  files: [
    // Intentionally listed in alphabetical order (like GitHub) so the Reading Order Engine visibly reorders them!
    {
      path: 'db/migrations/004_webhook_deliveries.sql',
      status: 'added',
      additions: 15,
      deletions: 0,
      language: 'sql',
      baseContent: null,
      headContent: MIGRATION_HEAD,
      patch: `@@ -0,0 +1,15 @@
+-- Migration: add webhook_deliveries table for retryable delivery tracking
+CREATE TABLE IF NOT EXISTS webhook_deliveries (
+  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
+  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
+  event_type TEXT NOT NULL,
+  payload JSONB NOT NULL,
+  attempt_count INTEGER NOT NULL DEFAULT 0,
+  next_retry_at TIMESTAMPTZ,
+  status TEXT NOT NULL DEFAULT 'pending',
+  last_error TEXT,
+  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
+);
+
+CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry
+  ON webhook_deliveries (status, next_retry_at)
+  WHERE status IN ('pending', 'retrying');`,
    },
    {
      path: 'src/components/WebhookEndpointCard.vue',
      status: 'modified',
      additions: 22,
      deletions: 4,
      language: 'vue',
      baseContent: SETTINGS_VUE_BASE,
      headContent: SETTINGS_VUE_HEAD,
      patch: `@@ -1,14 +1,32 @@
 <script setup lang="ts">
+import { ref } from 'vue'
 import type { WebhookEndpoint } from '../types/webhook'
 
 const props = defineProps<{
   endpoint: WebhookEndpoint
 }>()
+
+const emit = defineEmits<{
+  (e: 'update:rateLimit', value: number): void
+}>()
+
+const rateLimit = ref(props.endpoint.maxRequestsPerMinute)
+
+function saveLimit() {
+  emit('update:rateLimit', Math.max(1, rateLimit.value))
+}
 </script>
 
 <template>
-  <div class="rounded border border-slate-700 p-4">
-    <h3 class="text-sm font-semibold">{{ props.endpoint.url }}</h3>
-    <p class="text-xs text-slate-400">Status: {{ props.endpoint.enabled ? 'Active' : 'Paused' }}</p>
+  <div class="rounded border border-slate-700 p-4 space-y-3">
+    <div class="flex items-center justify-between">
+      <h3 class="text-sm font-semibold">{{ props.endpoint.url }}</h3>
+      <span class="text-xs text-slate-400">
+        {{ props.endpoint.enabled ? 'Active' : 'Paused' }}
+      </span>
+    </div>
+    <label class="flex items-center gap-2 text-xs text-slate-300">
+      <span>Max req / min</span>
+      <input
+        v-model.number="rateLimit"
+        type="number"
+        min="1"
+        class="w-20 rounded bg-slate-900 px-2 py-1 text-xs"
+        @change="saveLimit"
+      />
+    </label>
   </div>
 </template>`,
    },
    {
      path: 'src/services/rateLimiter.ts',
      status: 'added',
      additions: 39,
      deletions: 0,
      language: 'typescript',
      baseContent: null,
      headContent: RATE_LIMITER_HEAD,
      patch: `@@ -0,0 +1,39 @@
+import type { WebhookEndpoint } from '../types/webhook'
+
+interface BucketState {
+  tokens: number
+  lastRefillMs: number
+}
+
+/**
+ * Simple in-memory token bucket rate limiter keyed by webhook endpoint ID.
+ */
+export class EndpointRateLimiter {
+  private buckets = new Map<string, BucketState>()
+
+  constructor(private readonly now: () => number = () => Date.now()) {}
+
+  canConsume(endpoint: WebhookEndpoint): boolean {
+    const capacity = Math.max(1, endpoint.maxRequestsPerMinute)
+    const refillPerMs = capacity / 60_000
+    const currentNow = this.now()
+
+    const existing = this.buckets.get(endpoint.id) ?? {
+      tokens: capacity,
+      lastRefillMs: currentNow,
+    }
+
+    const elapsed = Math.max(0, currentNow - existing.lastRefillMs)
+    const refilled = Math.min(capacity, existing.tokens + elapsed * refillPerMs)
+
+    if (refilled < 1) {
+      this.buckets.set(endpoint.id, { tokens: refilled, lastRefillMs: currentNow })
+      return false
+    }
+
+    this.buckets.set(endpoint.id, { tokens: refilled - 1, lastRefillMs: currentNow })
+    return true
+  }
+
+  reset(endpointId: string): void {
+    this.buckets.delete(endpointId)
+  }
+}`,
    },
    {
      path: 'src/services/webhookDispatcher.ts',
      status: 'modified',
      additions: 49,
      deletions: 4,
      language: 'typescript',
      baseContent: DISPATCHER_BASE,
      headContent: DISPATCHER_HEAD,
      patch: `@@ -1,17 +1,62 @@
-import type { WebhookEndpoint, WebhookEventPayload } from '../types/webhook'
+import type {
+  RetryPolicy,
+  WebhookDeliveryResult,
+  WebhookEndpoint,
+  WebhookEventPayload,
+} from '../types/webhook'
+import { EndpointRateLimiter } from './rateLimiter'
+
+const DEFAULT_RETRY_POLICY: RetryPolicy = {
+  maxAttempts: 5,
+  baseDelayMs: 1_000,
+  maxDelayMs: 60_000,
+}
+
+export function computeBackoffMs(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
+  const exp = policy.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1))
+  return Math.min(policy.maxDelayMs, exp)
+}
 
 export class WebhookDispatcher {
-  async dispatch(endpoint: WebhookEndpoint, event: WebhookEventPayload): Promise<boolean> {
-    if (!endpoint.enabled) return false
+  constructor(
+    private readonly rateLimiter: EndpointRateLimiter = new EndpointRateLimiter(),
+    private readonly policy: RetryPolicy = DEFAULT_RETRY_POLICY,
+  ) {}
+
+  async dispatch(
+    endpoint: WebhookEndpoint,
+    event: WebhookEventPayload,
+    attempt = 1,
+  ): Promise<WebhookDeliveryResult> {
+    const deliveryId = \`del_\${event.id}_\${attempt}\`
+    if (!endpoint.enabled) {
+      return { deliveryId, status: 'failed', attemptCount: attempt, nextRetryAt: null }
+    }
+
+    if (!this.rateLimiter.canConsume(endpoint)) {
+      const delayMs = computeBackoffMs(attempt, this.policy)
+      return {
+        deliveryId,
+        status: 'retrying',
+        attemptCount: attempt,
+        nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
+        errorMessage: 'Rate limit exceeded for endpoint',
+      }
+    }
 
     const res = await fetch(endpoint.url, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         'X-Webhook-Event': event.type,
       },
       body: JSON.stringify(event),
     })
 
-    return res.ok
+    if (res.ok) {
+      return { deliveryId, status: 'delivered', attemptCount: attempt, nextRetryAt: null }
+    }
+
+    const canRetry = attempt < this.policy.maxAttempts
+    return {
+      deliveryId,
+      status: canRetry ? 'retrying' : 'failed',
+      attemptCount: attempt,
+      nextRetryAt: canRetry
+        ? new Date(Date.now() + computeBackoffMs(attempt, this.policy)).toISOString()
+        : null,
+      errorMessage: \`HTTP \${res.status}\`,
+    }
   }
 }`,
    },
    {
      path: 'src/tests/webhookDispatcher.test.ts',
      status: 'added',
      additions: 40,
      deletions: 0,
      language: 'typescript',
      baseContent: null,
      headContent: DISPATCHER_TEST_HEAD,
      patch: `@@ -0,0 +1,40 @@
+import { describe, expect, it } from 'vitest'
+import { EndpointRateLimiter } from '../services/rateLimiter'
+import { computeBackoffMs, WebhookDispatcher } from '../services/webhookDispatcher'
+import type { WebhookEndpoint } from '../types/webhook'
+
+const baseEndpoint: WebhookEndpoint = {
+  id: 'ep_1',
+  url: 'https://example.com/hook',
+  secret: 'sec_123',
+  enabled: true,
+  maxRequestsPerMinute: 2,
+}
+
+describe('WebhookDispatcher', () => {
+  it('computes capped exponential backoff', () => {
+    expect(computeBackoffMs(1)).toBe(1000)
+    expect(computeBackoffMs(3)).toBe(4000)
+    expect(computeBackoffMs(10)).toBe(60000)
+  })
+
+  it('queues retry when endpoint rate limit is exhausted', async () => {
+    let clock = 1_000_000
+    const limiter = new EndpointRateLimiter(() => clock)
+    const dispatcher = new WebhookDispatcher(limiter)
+
+    expect(limiter.canConsume(baseEndpoint)).toBe(true)
+    expect(limiter.canConsume(baseEndpoint)).toBe(true)
+
+    const result = await dispatcher.dispatch(baseEndpoint, {
+      id: 'evt_1',
+      type: 'invoice.paid',
+      createdAt: new Date(clock).toISOString(),
+      data: {},
+    })
+
+    expect(result.status).toBe('retrying')
+    expect(result.nextRetryAt).not.toBeNull()
+  })
+})`,
    },
    {
      path: 'src/types/webhook.ts',
      status: 'modified',
      additions: 20,
      deletions: 0,
      language: 'typescript',
      baseContent: TYPES_BASE,
      headContent: TYPES_HEAD,
      patch: `@@ -3,6 +3,26 @@ export interface WebhookEndpoint {
   url: string
   secret: string
   enabled: boolean
+  maxRequestsPerMinute: number
+}
+
+export type DeliveryStatus = 'pending' | 'retrying' | 'delivered' | 'failed'
+
+export interface RetryPolicy {
+  maxAttempts: number
+  baseDelayMs: number
+  maxDelayMs: number
+}
+
+export interface WebhookDeliveryResult {
+  deliveryId: string
+  status: DeliveryStatus
+  attemptCount: number
+  nextRetryAt: string | null
+  errorMessage?: string
 }
 
 export interface WebhookEventPayload {`,
    },
  ],
}
