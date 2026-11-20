import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchReviewerCandidates, mergeReviewerCandidates } from '@/services/github'
import * as httpModule from '@/services/http'

const user = (login: string, name: string | null = null) => ({ login, name, avatarUrl: '' })

describe('mergeReviewerCandidates', () => {
  it('puts suggested reviewers first, dedupes and drops excluded logins case-insensitively', () => {
    const result = mergeReviewerCandidates(
      [user('marcus'), user('Samira')],
      [user('ana'), user('MARCUS'), user('author'), user('samira'), user('priya')],
      { exclude: ['Author', 'priya'] },
    )
    expect(result.map((c) => [c.login, c.suggested])).toEqual([
      ['marcus', true],
      ['Samira', true],
      ['ana', false],
    ])
  })

  it('filters by login or name, strips a leading @ and ranks prefix matches first', () => {
    const assignable = [
      user('xander', 'Jonas Xander'),
      user('bjonas', null),
      user('jonas-berg', 'Jonas Berg'),
      user('kenji', 'Kenji Watanabe'),
    ]
    const result = mergeReviewerCandidates([], assignable, { query: '@Jon' })
    expect(result.map((c) => c.login)).toEqual(['jonas-berg', 'xander', 'bjonas'])
  })

  it('caps the number of results', () => {
    const many = Array.from({ length: 20 }, (_, i) => user(`user${i}`))
    expect(mergeReviewerCandidates([], many)).toHaveLength(8)
    expect(mergeReviewerCandidates([], many, { limit: 5 })).toHaveLength(5)
  })
})

describe('fetchReviewerCandidates', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requests suggestions only when the query is empty and maps the GraphQL response', async () => {
    const fetchSpy = vi.spyOn(httpModule, 'httpFetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  suggestedReviewers: [{ reviewer: user('marcus', 'Marcus Chen') }, { reviewer: null }],
                },
                assignableUsers: { nodes: [user('ana'), null, user('marcus'), user('me')] },
              },
            },
          }),
          { status: 200 },
        ),
    )

    const empty = await fetchReviewerCandidates('fake-pat', 'acme', 'shop', 7, '', ['me'])
    expect(empty.map((c) => [c.login, c.name, c.suggested])).toEqual([
      ['marcus', 'Marcus Chen', true],
      ['ana', null, false],
    ])
    const firstBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    expect(firstBody.variables).toEqual({
      owner: 'acme',
      repo: 'shop',
      number: 7,
      query: null,
      withSuggestions: true,
    })
    expect(firstBody.query).toContain('suggestedReviewers')
    expect(firstBody.query).toContain('assignableUsers(query: $query, first: 20)')

    await fetchReviewerCandidates('fake-pat', 'acme', 'shop', 7, ' @an ')
    const secondBody = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body))
    expect(secondBody.variables).toMatchObject({ query: 'an', withSuggestions: false })
  })
})
