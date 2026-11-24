import { describe, expect, it } from 'vitest'
import { MOCK_PR } from '@/data/mockPR'
import {
  buildReadingOrder,
  classifyLayer,
  isGeneratedOrLockfile,
  isLockfile,
  matchesIgnorePatterns,
} from '@/services/readingOrder'
import type { PRFile } from '@/types/pr'

function makeFile(overrides: Partial<PRFile> & { path: string }): PRFile {
  return {
    status: 'modified',
    additions: 10,
    deletions: 2,
    patch: '@@ -1,1 +1,2 @@\n+line',
    baseContent: '',
    headContent: '',
    language: 'text',
    ...overrides,
  }
}

describe('isGeneratedOrLockfile', () => {
  it('identifies common lockfiles and generated assets', () => {
    expect(isLockfile('package-lock.json')).toBe(true)
    expect(isLockfile('bun.lock')).toBe(true)
    expect(isLockfile('Cargo.lock')).toBe(true)
    expect(isLockfile('src/App.csproj')).toBe(false)

    expect(isGeneratedOrLockfile('package-lock.json')).toBe(true)
    expect(isGeneratedOrLockfile('bun.lockb')).toBe(true)
    expect(isGeneratedOrLockfile('yarn.lock')).toBe(true)
    expect(isGeneratedOrLockfile('pnpm-lock.yaml')).toBe(true)
    expect(isGeneratedOrLockfile('poetry.lock')).toBe(true)
    expect(isGeneratedOrLockfile('uv.lock')).toBe(true)
    expect(isGeneratedOrLockfile('Gemfile.lock')).toBe(true)
    expect(isGeneratedOrLockfile('go.sum')).toBe(true)
    expect(isGeneratedOrLockfile('composer.lock')).toBe(true)
    expect(isGeneratedOrLockfile('packages.lock.json')).toBe(true)
    expect(isGeneratedOrLockfile('Forms/MainForm.Designer.cs')).toBe(true)
    expect(isGeneratedOrLockfile('obj/Views/Home.g.cs')).toBe(true)
    expect(isGeneratedOrLockfile('public/vendor/app.min.js')).toBe(true)
    expect(isGeneratedOrLockfile('public/vendor/app.min.css')).toBe(true)
    expect(isGeneratedOrLockfile('dist/bundle.js')).toBe(true)
    expect(isGeneratedOrLockfile('assets/app.js.map')).toBe(true)
    expect(isGeneratedOrLockfile('src/__snapshots__/App.test.ts.snap')).toBe(true)
    expect(isGeneratedOrLockfile('proto/orders.pb.go')).toBe(true)
    expect(isGeneratedOrLockfile('src/schema_generated.ts')).toBe(true)

    expect(isGeneratedOrLockfile('src/Services/OrderService.cs')).toBe(false)
    expect(isGeneratedOrLockfile('src/App.vue')).toBe(false)
  })
})

describe('classifyLayer', () => {
  it('categorizes files into the 5 architectural layers', () => {
    expect(classifyLayer('db/migrations/004_webhook_deliveries.sql')).toBe('config')
    expect(classifyLayer('src/types/webhook.ts')).toBe('types')
    expect(classifyLayer('src/services/rateLimiter.ts')).toBe('core')
    expect(classifyLayer('src/components/WebhookEndpointCard.vue')).toBe('ui')
    expect(classifyLayer('src/tests/webhookDispatcher.test.ts')).toBe('tests')
  })

  it('categorizes C# files into the appropriate architectural layers', () => {
    expect(classifyLayer('src/Orders/Orders.csproj')).toBe('config')
    expect(classifyLayer('Orders.sln')).toBe('config')
    expect(classifyLayer('src/Orders/appsettings.Production.json')).toBe('config')

    expect(classifyLayer('src/Orders/IOrderRepository.cs')).toBe('types')
    expect(classifyLayer('src/Orders/Models/Order.cs')).toBe('types')
    expect(classifyLayer('src/Orders/Dtos/CreateOrderDto.cs')).toBe('types')

    expect(classifyLayer('src/Orders/Services/OrderService.cs')).toBe('core')

    expect(classifyLayer('src/Orders/OrdersController.cs')).toBe('ui')
    expect(classifyLayer('src/Orders/Controllers/BillingController.cs')).toBe('ui')
    expect(classifyLayer('src/Orders/Program.cs')).toBe('ui')

    expect(classifyLayer('tests/Orders.Tests/OrderServiceTests.cs')).toBe('tests')
    expect(classifyLayer('src/Orders/OrderValidatorTest.cs')).toBe('tests')
    expect(classifyLayer('Orders.Tests/Fixtures/OrderFixture.cs')).toBe('tests')
    expect(classifyLayer('Orders.Domain.Test/Fixtures/OrderFixture.cs')).toBe('tests')
  })

  it('categorizes *Test.js and *.Test/ files as tests without false positives', () => {
    expect(
      classifyLayer('implementation/Orders.Domain.Test/Services/OrderFormatting/OrderFormatterTest.js'),
    ).toBe('tests')
    expect(classifyLayer('src/OrderFormatting/OrderFormatterTest.js')).toBe('tests')
    expect(classifyLayer('implementation/Orders.Domain.Test/Fixtures/Helper.js')).toBe('tests')
    expect(classifyLayer('src/utils/latest.ts')).toBe('core')
    expect(classifyLayer('src/utils/contest.js')).toBe('core')
  })
})

describe('buildReadingOrder', () => {
  it('sorts dependencies before consumers and pairs tests immediately after impl in bottom-up mode', () => {
    const steps = buildReadingOrder(MOCK_PR.files, 'bottom-up')
    const paths = steps.map((s) => s.file.path)

    expect(paths).toEqual([
      'db/migrations/004_webhook_deliveries.sql',
      'src/types/webhook.ts',
      'docs/webhooks.md',
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

  it('deprioritizes generated files and lockfiles to the very end of the tour', () => {
    const files: PRFile[] = [
      ...MOCK_PR.files,
      makeFile({ path: 'bun.lock', additions: 420, deletions: 180 }),
      makeFile({ path: 'src/Forms/MainForm.Designer.cs', language: 'csharp', additions: 90 }),
    ]

    const steps = buildReadingOrder(files, 'bottom-up')
    const lastTwo = steps.slice(-2)
    expect(lastTwo.map((s) => s.file.path)).toEqual([
      'bun.lock',
      'src/Forms/MainForm.Designer.cs',
    ])
    expect(lastTwo.every((s) => s.isGenerated === true)).toBe(true)
  })

  it('orders C# files by using/namespace dependencies, extracts ReferencedContext, and pairs *Tests.cs', () => {
    const csFiles: PRFile[] = [
      makeFile({
        path: 'src/Orders/Controllers/OrdersController.cs',
        language: 'csharp',
        headContent: `using MyApp.Orders.Services;
using MyApp.Orders.Models;

namespace MyApp.Orders.Controllers;

public class OrdersController
{
    private readonly OrderService _service;
    public OrderSummary Get(string id) => _service.Get(id);
}`,
      }),
      makeFile({
        path: 'tests/Orders.Tests/OrderServiceTests.cs',
        language: 'csharp',
        headContent: `using MyApp.Orders.Services;

namespace MyApp.Orders.Tests;

public class OrderServiceTests
{
    public void CreatesOrder() { var svc = new OrderService(); }
}`,
      }),
      makeFile({
        path: 'src/Orders/Services/OrderService.cs',
        language: 'csharp',
        headContent: `using MyApp.Orders.Models;

namespace MyApp.Orders.Services;

public class OrderService
{
    public OrderSummary Get(string id) => new OrderSummary(id);
}`,
      }),
      makeFile({
        path: 'src/Orders/Models/OrderSummary.cs',
        language: 'csharp',
        headContent: `namespace MyApp.Orders.Models;

public sealed record OrderSummary(string Id);`,
      }),
      makeFile({
        path: 'src/Orders/Orders.csproj',
        language: 'xml',
        headContent: `<Project Sdk="Microsoft.NET.Sdk.Web"></Project>`,
      }),
    ]

    const steps = buildReadingOrder(csFiles, 'bottom-up')
    const paths = steps.map((s) => s.file.path)

    expect(paths).toEqual([
      'src/Orders/Orders.csproj',
      'src/Orders/Models/OrderSummary.cs',
      'src/Orders/Services/OrderService.cs',
      'tests/Orders.Tests/OrderServiceTests.cs',
      'src/Orders/Controllers/OrdersController.cs',
    ])

    const serviceStep = steps.find((s) => s.file.path === 'src/Orders/Services/OrderService.cs')!
    expect(serviceStep.dependencies).toContain('src/Orders/Models/OrderSummary.cs')
    expect(serviceStep.referencedContexts.length).toBe(1)
    expect(serviceStep.referencedContexts[0].symbolNames).toContain('OrderSummary')

    const testStep = steps.find((s) => s.file.path === 'tests/Orders.Tests/OrderServiceTests.cs')!
    expect(testStep.pairedWith).toBe('src/Orders/Services/OrderService.cs')
  })

  it('orders C# files by same/enclosing namespace and PR-wide global usings without local usings', () => {
    const csFiles: PRFile[] = [
      makeFile({
        path: 'src/Orders/Services/OrderProcessor.cs',
        language: 'csharp',
        headContent: `namespace MyApp.Orders.Services;

public class OrderProcessor
{
    public OrderTotal Calculate(Money amount) => new OrderTotal(amount);
}`,
      }),
      makeFile({
        path: 'src/Orders/Services/OrderTotal.cs',
        language: 'csharp',
        headContent: `namespace MyApp.Orders.Services;

public sealed record OrderTotal(Money Amount);`,
      }),
      makeFile({
        path: 'src/Orders/Services/UnrelatedHelper.cs',
        language: 'csharp',
        headContent: `namespace MyApp.Orders.Services;

public static class UnrelatedHelper {}`,
      }),
      makeFile({
        path: 'src/Orders/Shared/Money.cs',
        language: 'csharp',
        headContent: `namespace MyApp.Orders.Shared;

public readonly record struct Money(decimal Value);`,
      }),
      makeFile({
        path: 'src/Orders/GlobalUsings.cs',
        language: 'csharp',
        headContent: `global using MyApp.Orders.Shared;`,
      }),
    ]

    const steps = buildReadingOrder(csFiles, 'bottom-up')
    const paths = steps.map((s) => s.file.path)

    // Money (from global using) -> OrderTotal (uses Money, same ns as OrderProcessor) -> OrderProcessor
    expect(paths.indexOf('src/Orders/Shared/Money.cs')).toBeLessThan(
      paths.indexOf('src/Orders/Services/OrderTotal.cs'),
    )
    expect(paths.indexOf('src/Orders/Services/OrderTotal.cs')).toBeLessThan(
      paths.indexOf('src/Orders/Services/OrderProcessor.cs'),
    )

    const processorStep = steps.find((s) => s.file.path === 'src/Orders/Services/OrderProcessor.cs')!
    expect(processorStep.dependencies).toContain('src/Orders/Services/OrderTotal.cs')
    expect(processorStep.dependencies).toContain('src/Orders/Shared/Money.cs')
    expect(processorStep.dependencies).not.toContain('src/Orders/Services/UnrelatedHelper.cs')
  })

  it('pushes files matching custom ignorePatterns to the end and marks them generated', () => {
    expect(matchesIgnorePatterns('src/components/Button.stories.tsx', ['*.stories.tsx'])).toBe(true)
    expect(matchesIgnorePatterns('vendor/bundle/foo.js', ['vendor/**'])).toBe(true)
    expect(matchesIgnorePatterns('src/app.ts', ['*.stories.tsx', 'vendor/**'])).toBe(false)

    const files: PRFile[] = [
      makeFile({ path: 'src/a.stories.tsx' }),
      makeFile({ path: 'src/core/service.ts' }),
      makeFile({ path: 'vendor/lib/helper.js' }),
    ]
    const steps = buildReadingOrder(files, 'bottom-up', {
      ignorePatterns: ['*.stories.tsx', 'vendor/**'],
    })
    expect(steps.map((s) => s.file.path)).toEqual([
      'src/core/service.ts',
      'src/a.stories.tsx',
      'vendor/lib/helper.js',
    ])
    expect(steps[0].isGenerated).toBeUndefined()
    expect(steps[1].isGenerated).toBe(true)
    expect(steps[2].isGenerated).toBe(true)
  })
})
