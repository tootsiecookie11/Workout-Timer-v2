/**
 * Supabase JWT middleware for Hono (Cloudflare Workers).
 *
 * Supabase signs JWTs with HS256 using the project's JWT_SECRET.
 * This middleware verifies the signature via Web Crypto API (no external deps),
 * then calls next() if the token is valid.
 *
 * Usage:
 *   import { supabaseAuth } from './supabaseAuth';
 *   app.post('/api/protected', supabaseAuth, handler);
 *
 * Required env binding:
 *   SUPABASE_JWT_SECRET — set via `wrangler secret put SUPABASE_JWT_SECRET` in prod.
 *   For local dev / CI add it to wrangler.jsonc [vars] (never commit real secrets).
 */

import type { MiddlewareHandler } from 'hono';

// ─── Public type: minimum Bindings required for this middleware ───────────────

export interface SupabaseAuthBindings {
  SUPABASE_JWT_SECRET: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Decode a base64url string into a Uint8Array. */
function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded  = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary  = atob(padded);
  const bytes   = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Verify a Supabase HS256 JWT and return its decoded payload. */
async function verifySupabaseJWT(
  token:  string,
  secret: string,
): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT: expected 3 segments');

  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  // Import the HMAC-SHA256 signing key
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  // Verify the signature over "<header>.<payload>"
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sigBytes     = base64urlDecode(sigB64);
  const valid        = await crypto.subtle.verify('HMAC', key, sigBytes, signingInput);
  if (!valid) throw new Error('Invalid JWT signature');

  // Decode payload
  const payloadBytes = base64urlDecode(payloadB64);
  const payload      = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;

  // Check expiry
  const exp = payload['exp'];
  if (typeof exp === 'number' && exp < Math.floor(Date.now() / 1000)) {
    throw new Error('JWT has expired');
  }

  return payload;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Hono middleware — verifies the Supabase JWT from the Authorization header.
 * On success, sets `c.set('supabaseUser', payload)` for downstream handlers.
 * On failure, returns 401.
 */
export const supabaseAuth: MiddlewareHandler<{ Bindings: SupabaseAuthBindings }> = async (
  c,
  next,
) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authorization header is required (Bearer <supabase_jwt>).' }, 401);
  }

  const token  = authHeader.slice(7).trim();
  const secret = c.env.SUPABASE_JWT_SECRET;

  if (!secret) {
    console.error('[supabaseAuth] SUPABASE_JWT_SECRET is not configured');
    return c.json({ error: 'Server misconfiguration: JWT secret not set.' }, 500);
  }

  try {
    const payload = await verifySupabaseJWT(token, secret);
    // Make the decoded payload available to route handlers if needed
    c.set('supabaseUser' as never, payload);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'JWT verification failed';
    return c.json({ error: `Unauthorized: ${msg}` }, 401);
  }

  await next();
};
