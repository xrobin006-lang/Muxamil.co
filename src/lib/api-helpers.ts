import { NextResponse } from 'next/server'

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export const errors = {
  unauthorized: () => fail('You need to sign in to do that.', 401),
  forbidden: () => fail('You do not have permission to do that.', 403),
  blocked: () => fail('Your account has been restricted by the administrator.', 403),
  notFound: (what = 'Resource') => fail(`${what} not found.`, 404),
  server: () => fail('Something went wrong. Please try again.', 500),
  badRequest: (msg = 'Invalid request.') => fail(msg, 400),
}

/** Wrap a route handler so unexpected throws return a friendly 500. */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    console.error('[api]', err)
    return errors.server()
  }
}
