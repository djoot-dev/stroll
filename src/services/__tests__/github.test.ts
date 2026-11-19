import { afterEach, describe, expect, it } from 'vitest'
import {
  getGitHubEndpoints,
  normalizeGitHubHost,
  parsePRUrl,
  setGitHubHost,
} from '../github'

describe('github host & URL parsing', () => {
  afterEach(() => {
    setGitHubHost('github.com')
  })

  it('normalizes host strings and falls back to github.com', () => {
    expect(normalizeGitHubHost('')).toBe('github.com')
    expect(normalizeGitHubHost('   ')).toBe('github.com')
    expect(normalizeGitHubHost('https://GitHub.com/')).toBe('github.com')
    expect(normalizeGitHubHost('https://GHE.Company.com/api/v3')).toBe('ghe.company.com')
    expect(normalizeGitHubHost('ghe.internal:8443/')).toBe('ghe.internal:8443')
  })

  it('derives GraphQL and REST endpoints for github.com and custom GHE hosts', () => {
    expect(getGitHubEndpoints('github.com')).toEqual({
      graphqlUrl: 'https://api.github.com/graphql',
      restUrl: 'https://api.github.com',
    })

    expect(getGitHubEndpoints('ghe.company.com')).toEqual({
      graphqlUrl: 'https://ghe.company.com/api/graphql',
      restUrl: 'https://ghe.company.com/api/v3',
    })
  })

  it('parses github.com and custom GitHub Enterprise PR URLs', () => {
    expect(parsePRUrl('https://github.com/acme/stroll/pull/42')).toEqual({
      owner: 'acme',
      repo: 'stroll',
      number: 42,
    })

    expect(parsePRUrl('https://github.com/acme/stroll/pull/42/files')).toEqual({
      owner: 'acme',
      repo: 'stroll',
      number: 42,
    })

    // Custom host via explicit parameter
    expect(
      parsePRUrl('https://ghe.company.com/platform/core-api/pull/99/commits', 'ghe.company.com'),
    ).toEqual({
      owner: 'platform',
      repo: 'core-api',
      number: 99,
    })

    // Custom host via configured store/module host
    setGitHubHost('git.corp.example')
    expect(parsePRUrl('https://git.corp.example/team/service/pull/7')).toEqual({
      owner: 'team',
      repo: 'service',
      number: 7,
    })
    // github.com remains accepted even when custom host is configured
    expect(parsePRUrl('https://github.com/acme/stroll/pull/12')).toEqual({
      owner: 'acme',
      repo: 'stroll',
      number: 12,
    })

    // Rejects unrelated hosts or non-PR URLs
    expect(parsePRUrl('https://gitlab.com/acme/stroll/pull/42')).toBeNull()
    expect(parsePRUrl('https://github.com/acme/stroll/issues/42')).toBeNull()
    expect(parsePRUrl('not-a-url')).toBeNull()
  })
})
