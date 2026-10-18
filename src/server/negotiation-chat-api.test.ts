import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createNegotiationRequest,
  getNegotiationStatus,
  respondToNegotiationRequest,
} from '../../my-travel-app/src/api/chatApi.js'

describe('travel negotiation chat API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('loads family negotiation status with the signed-in same-origin session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ familyCode: '1234', conflicts: [], requests: [] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getNegotiationStatus('1234')).resolves.toMatchObject({
      familyCode: '1234',
      requests: [],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/travel/families/1234/negotiations/status',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('creates an idempotent request without sending a client-supplied identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          status: 'created',
          request: { requestId: 'request-1' },
        },
        { status: 201 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await createNegotiationRequest({
      familyId: '12/34',
      preference: 'tripPace',
      targetUserId: 'auth0|client',
      idempotencyKey: 'chat-start-1',
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/travel/families/12%2F34/negotiations/requests')
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Idempotency-Key': 'chat-start-1',
    })
    expect(JSON.parse(options.body)).toEqual({
      preference: 'tripPace',
      targetUserId: 'auth0|client',
    })
  })

  it('responds using the server-authenticated client session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ request: { requestId: 'request-1', status: 'accepted' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await respondToNegotiationRequest({
      familyId: '1234',
      requestId: 'request-1',
      answer: 'accept',
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/travel/families/1234/negotiations/request-1/respond')
    expect(options.credentials).toBe('same-origin')
    expect(JSON.parse(options.body)).toEqual({ answer: 'accept' })
  })

  it('surfaces server authorization errors to the chat UI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          { error: 'Only the requested user can answer.' },
          { status: 403 },
        ),
      ),
    )

    await expect(
      respondToNegotiationRequest({
        familyId: '1234',
        requestId: 'request-1',
        answer: 'reject',
      }),
    ).rejects.toMatchObject({
      message: 'Only the requested user can answer.',
      status: 403,
    })
  })
})
