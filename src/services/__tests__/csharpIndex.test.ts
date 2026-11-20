import { describe, expect, it } from 'vitest'
import {
  extractCSharpScopeContext,
  groupCSharpTypeEntries,
  pickCSharpTypeEntry,
} from '../csharpIndex'

const index = groupCSharpTypeEntries([
  {
    name: 'IBillingService',
    namespace: 'MyApp.Domain.Services.Billing',
    path: 'src/MyApp.Domain/Services/Billing/IBillingService.cs',
  },
  { name: 'IClock', namespace: 'MyApp.Domain.Interfaces', path: 'src/MyApp.Domain/Interfaces/IClock.cs' },
  { name: 'IClock', namespace: 'Vendor.Time', path: 'lib/Vendor/IClock.cs' },
  { name: 'Options', namespace: 'MyApp.Host', path: 'src/MyApp.Host/Options.cs' },
  { name: 'Options', namespace: 'MyApp.Worker', path: 'src/MyApp.Worker/Options.cs' },
  { name: 'Helper', namespace: null, path: 'src/MyApp.Host.Tests/Helper.cs' },
  { name: 'Helper', namespace: null, path: 'src/MyApp.Host/Helper.cs' },
])

const hostFile = `using System;
using MyApp.Domain.Services.Billing;
using Vendor.Time;
using DomainClock = MyApp.Domain.Interfaces.IClock;

namespace MyApp.Host
{
    public static class Startup {}
}
`

describe('extractCSharpScopeContext', () => {
  it('collects usings, aliases and declared namespaces', () => {
    const ctx = extractCSharpScopeContext(hostFile)
    expect(ctx.usings).toEqual(['System', 'MyApp.Domain.Services.Billing', 'Vendor.Time'])
    expect(ctx.aliases.get('DomainClock')).toBe('MyApp.Domain.Interfaces.IClock')
    expect(ctx.namespaces).toEqual(['MyApp.Host'])
  })

  it('handles file-scoped namespaces and global/static usings', () => {
    const ctx = extractCSharpScopeContext(
      'global using MyApp.Shared;\nusing static MyApp.Math.Ops;\nnamespace MyApp.Api;\n',
    )
    expect(ctx.usings).toEqual(['MyApp.Shared', 'MyApp.Math.Ops'])
    expect(ctx.namespaces).toEqual(['MyApp.Api'])
  })
})

describe('pickCSharpTypeEntry', () => {
  const ctx = extractCSharpScopeContext(hostFile)
  const importer = 'src/MyApp.Host/Startup.cs'

  it('resolves a type whose folder does not mirror its namespace', () => {
    expect(pickCSharpTypeEntry('IBillingService', index, ctx, importer)?.path).toBe(
      'src/MyApp.Domain/Services/Billing/IBillingService.cs',
    )
  })

  it('prefers the namespace imported by the file among same-named types', () => {
    expect(pickCSharpTypeEntry('IClock', index, ctx, importer)?.namespace).toBe('Vendor.Time')
  })

  it('follows using aliases', () => {
    expect(pickCSharpTypeEntry('DomainClock', index, ctx, importer)?.namespace).toBe(
      'MyApp.Domain.Interfaces',
    )
  })

  it("prefers the file's own namespace over others", () => {
    expect(pickCSharpTypeEntry('Options', index, ctx, importer)?.path).toBe(
      'src/MyApp.Host/Options.cs',
    )
  })

  it('prefers non-test files near the importer when namespaces do not decide', () => {
    expect(pickCSharpTypeEntry('Helper', index, ctx, importer)?.path).toBe('src/MyApp.Host/Helper.cs')
  })

  it('returns null for unknown identifiers', () => {
    expect(pickCSharpTypeEntry('services', index, ctx, importer)).toBeNull()
  })
})
