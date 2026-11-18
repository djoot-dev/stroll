import { describe, expect, it } from 'vitest'
import { MOCK_PR } from '@/data/mockPR'
import { buildReadingOrder, classifyLayer } from '@/services/readingOrder'

describe('classifyLayer', () => {
  it('categorizes files into the 5 architectural layers', () => {
    expect(classifyLayer('db/migrations/004_webhook_deliveries.sql')).toBe('config')
    expect(classifyLayer('src/types/webhook.ts')).toBe('types')
    expect(classifyLayer('src/services/rateLimiter.ts')).toBe('core')
    expect(classifyLayer('src/components/WebhookEndpointCard.vue')).toBe('ui')
    expect(classifyLayer('src/tests/webhookDispatcher.test.ts')).toBe('tests')
  })
})

describe('buildReadingOrder', () => {
  it('sorts dependencies before consumers and pairs tests immediately after impl in bottom-up mode', () => {
    const steps = buildReadingOrder(MOCK_PR.files, 'bottom-up')
    const paths = steps.map((s) => s.file.path)

    expect(paths).toEqual([
      'db/migrations/004_webhook_deliveries.sql',
      'src/types/webhook.ts',
      'src/services/rateLimiter.ts',
      'src/services/webhookDispatcher.ts',
      'src/tests/webhookDispatcher.test.ts',
      'src/components/WebhookEndpointCard.vue',
    ])

    const dispatcherStep = steps.find((s) => s.file.path === 'src/services/webhookDispatcher.ts')
    expect(dispatcherStep?.dependencies).toContain('src/types/webhook.ts')
    expect(dispatcherStep?.dependencies).toContain('src/services/rateLimiter.ts')
    expect(dispatcherStep?.referencedContexts.length).toBe(2)
  })

  it('reverses dependency priority in top-down mode while keeping test pairing', () => {
    const steps = buildReadingOrder(MOCK_PR.files, 'top-down')
    const paths = steps.map((s) => s.file.path)

    expect(paths.indexOf('src/components/WebhookEndpointCard.vue')).toBeLessThan(
      paths.indexOf('src/types/webhook.ts'),
    )
    expect(paths.indexOf('src/tests/webhookDispatcher.test.ts')).toBe(
      paths.indexOf('src/services/webhookDispatcher.ts') + 1,
    )
  })
})
