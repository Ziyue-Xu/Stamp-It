import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../../worker.js'
import { registerStaticRoutes } from './http-routes.js'

describe('static routes', () => {
  it('redirects the root page to the travel app', async () => {
    const app = new Hono<{ Bindings: Env }>()
    const fetchAsset = vi.fn(async () => new Response('template page'))
    registerStaticRoutes(app)

    const response = await app.request(
      '/',
      {},
      { ASSETS: { fetch: fetchAsset } } as unknown as Env,
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/travel')
    expect(fetchAsset).not.toHaveBeenCalled()
  })
})
