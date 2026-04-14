import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';

// ─── JWT test helpers ─────────────────────────────────────────────────────────

function base64url(data: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]!);
	return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Create a signed HS256 JWT with the given secret and payload. */
async function signJWT(
	secret: string,
	payload: Record<string, unknown>,
): Promise<string> {
	const enc = new TextEncoder();

	const header  = base64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
	const body    = base64url(enc.encode(JSON.stringify(payload)));
	const signingInput = enc.encode(`${header}.${body}`);

	const key = await crypto.subtle.importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);

	const sig = await crypto.subtle.sign('HMAC', key, signingInput);
	return `${header}.${body}.${base64url(new Uint8Array(sig))}`;
}

/** Valid test payload — expires far in the future. */
function testPayload(): Record<string, unknown> {
	return {
		sub:  'test-user-id',
		role: 'authenticated',
		aud:  'authenticated',
		iat:  Math.floor(Date.now() / 1000),
		exp:  Math.floor(Date.now() / 1000) + 3600,
	};
}

// ─── Health check ─────────────────────────────────────────────────────────────

describe('GET /', () => {
	it('returns API version string', async () => {
		const req = new Request('http://localhost/');
		const ctx = createExecutionContext();
		const res = await worker.fetch(req, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('Galawgaw Worker API');
	});
});

// ─── POST /api/parse-dsl ──────────────────────────────────────────────────────

describe('POST /api/parse-dsl', () => {
	const url = 'http://localhost/api/parse-dsl';

	// Convenience: post with optional auth + body
	async function post(
		body: unknown,
		jwt?: string,
	): Promise<Response> {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
		const req = new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
		const ctx = createExecutionContext();
		const res = await worker.fetch(req, env, ctx);
		await waitOnExecutionContext(ctx);
		return res;
	}

	it('returns 401 when Authorization header is absent', async () => {
		const res  = await post({ dsl: 'reps >= 5' });
		const json = await res.json() as { error: string };
		expect(res.status).toBe(401);
		expect(json.error).toMatch(/authorization/i);
	});

	it('returns 401 when JWT signature is invalid', async () => {
		const res  = await post({ dsl: 'reps >= 5' }, 'not.a.valid.jwt');
		expect(res.status).toBe(401);
	});

	it('returns 401 when JWT is signed with the wrong secret', async () => {
		const jwt = await signJWT('wrong-secret', testPayload());
		const res  = await post({ dsl: 'reps >= 5' }, jwt);
		expect(res.status).toBe(401);
	});

	it('returns 401 when JWT is expired', async () => {
		const secret = (env as { SUPABASE_JWT_SECRET: string }).SUPABASE_JWT_SECRET;
		const expiredPayload = { ...testPayload(), exp: Math.floor(Date.now() / 1000) - 1 };
		const jwt = await signJWT(secret, expiredPayload);
		const res  = await post({ dsl: 'reps >= 5' }, jwt);
		expect(res.status).toBe(401);
	});

	it('returns 400 when "dsl" field is missing', async () => {
		const secret = (env as { SUPABASE_JWT_SECRET: string }).SUPABASE_JWT_SECRET;
		const jwt = await signJWT(secret, testPayload());
		const res  = await post({}, jwt);
		expect(res.status).toBe(400);
	});

	it('returns 400 when "dsl" field is empty', async () => {
		const secret = (env as { SUPABASE_JWT_SECRET: string }).SUPABASE_JWT_SECRET;
		const jwt = await signJWT(secret, testPayload());
		const res  = await post({ dsl: '   ' }, jwt);
		expect(res.status).toBe(400);
	});

	it('returns 200 + AST for a valid comparison expression', async () => {
		const secret = (env as { SUPABASE_JWT_SECRET: string }).SUPABASE_JWT_SECRET;
		const jwt    = await signJWT(secret, testPayload());
		const res    = await post({ dsl: 'reps >= 5' }, jwt);
		const json   = await res.json() as { ast: { kind: string; op: string } };
		expect(res.status).toBe(200);
		expect(json.ast).toMatchObject({ kind: 'cmp', op: '>=' });
	});

	it('returns 200 + AST for a compound expression', async () => {
		const secret = (env as { SUPABASE_JWT_SECRET: string }).SUPABASE_JWT_SECRET;
		const jwt    = await signJWT(secret, testPayload());
		const res    = await post({ dsl: 'reps >= 5 && round <= 3' }, jwt);
		const json   = await res.json() as { ast: { kind: string } };
		expect(res.status).toBe(200);
		expect(json.ast).toMatchObject({ kind: 'and' });
	});

	it('returns 200 + AST for the "always" keyword', async () => {
		const secret = (env as { SUPABASE_JWT_SECRET: string }).SUPABASE_JWT_SECRET;
		const jwt    = await signJWT(secret, testPayload());
		const res    = await post({ dsl: 'always' }, jwt);
		const json   = await res.json() as { ast: { kind: string } };
		expect(res.status).toBe(200);
		expect(json.ast).toMatchObject({ kind: 'always' });
	});

	it('returns 200 + AST for a duration comparison', async () => {
		const secret = (env as { SUPABASE_JWT_SECRET: string }).SUPABASE_JWT_SECRET;
		const jwt    = await signJWT(secret, testPayload());
		const res    = await post({ dsl: 'time >= 30s' }, jwt);
		const json   = await res.json() as { ast: { kind: string } };
		expect(res.status).toBe(200);
		expect(json.ast.kind).toBe('cmp');
	});

	it('returns 422 with error details for invalid DSL', async () => {
		const secret = (env as { SUPABASE_JWT_SECRET: string }).SUPABASE_JWT_SECRET;
		const jwt    = await signJWT(secret, testPayload());
		const res    = await post({ dsl: 'reps @@ 5' }, jwt);
		const json   = await res.json() as { error: string; pretty: string; span: { start: number; end: number } };
		expect(res.status).toBe(422);
		expect(json.error).toBeTruthy();
		expect(json.pretty).toContain('^');
		expect(typeof json.span.start).toBe('number');
	});

	it('returns 422 for unterminated string literal', async () => {
		const secret = (env as { SUPABASE_JWT_SECRET: string }).SUPABASE_JWT_SECRET;
		const jwt    = await signJWT(secret, testPayload());
		const res    = await post({ dsl: 'user == "Heavy' }, jwt);
		expect(res.status).toBe(422);
	});

	// Integration style — uses SELF.fetch which routes through the deployed worker
	it('integration: GET / returns API banner', async () => {
		const res = await SELF.fetch('http://localhost/');
		expect(res.status).toBe(200);
	});
});
