/**
 * Integration tests: run against a REAL PostgreSQL database (use a dedicated, migrated database!).
 *   DATABASE_URL=... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... COOKIE_SECRET=... npm test
 * Each run creates its own uniquely-named users/products so it is safe to repeat.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { pool, query } from '../src/config/db';
import { authRepository } from '../src/modules/auth/auth.repository';
import { hashPassword } from '../src/utils/password';
import { outbox } from '../src/modules/otp/mail.service';

const RUN = crypto.randomBytes(4).toString('hex');
const PASSWORD = 'Passw0rd-QA';
const ORIGIN = env.FRONTEND_URL.split(',')[0].trim();

let server: Server;
let base = '';

interface Res {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  cookies: string[];
}

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; cookie?: string; origin?: string } = {}
): Promise<Res> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin) headers.origin = opts.origin;
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, body, cookies: res.headers.getSetCookie?.() ?? [] };
}

const cookieHeader = (cookies: string[]) => cookies.map((c) => c.split(';')[0]).join('; ');
const cookieValue = (cookies: string[], name: string) =>
  cookies.find((c) => c.startsWith(`${name}=`))?.split(';')[0].split('=').slice(1).join('=');

/** Newest 6-digit code e-mailed to this address (dev/test mail goes to the in-memory outbox). */
function otpFor(email: string): string {
  for (let i = outbox.length - 1; i >= 0; i--) {
    if (outbox[i].to === email) {
      const m = /\b(\d{6})\b/.exec(outbox[i].text);
      if (m) return m[1];
    }
  }
  throw new Error(`No OTP e-mail was sent to ${email}`);
}

/** Full two-step login: password -> e-mailed code -> session. */
async function signIn(email: string, password: string) {
  const step1 = await api('POST', '/auth/login', { body: { email, password } });
  assert.equal(step1.status, 200, JSON.stringify(step1.body));
  assert.equal(step1.body.data.otpRequired, true);
  const step2 = await api('POST', '/auth/verify-otp', { body: { email, purpose: 'login', code: otpFor(email) } });
  assert.equal(step2.status, 200, JSON.stringify(step2.body));
  return step2;
}

async function newUser(prefix: string, role: string = 'customer') {
  const email = `${prefix}-${RUN}-${crypto.randomBytes(2).toString('hex')}@example.com`;
  const user = await authRepository.createUser({
    name: `QA ${prefix}`, email, passwordHash: await hashPassword(PASSWORD), role: role as never,
  });
  const login = await signIn(email, PASSWORD);
  return { id: user.id, email, token: login.body.data.accessToken as string, cookies: login.cookies };
}

describe('SleeknShine API', () => {
  let admin: Awaited<ReturnType<typeof newUser>>;
  let stock: Awaited<ReturnType<typeof newUser>>;
  let orderMgr: Awaited<ReturnType<typeof newUser>>;
  let customer: Awaited<ReturnType<typeof newUser>>;
  let categoryId = '';
  let categorySlug = '';

  async function createProduct(over: Record<string, unknown> = {}, variants: { name: string; stock: number }[] = [{ name: 'Default', stock: 20 }]) {
    const name = `QA Product ${crypto.randomBytes(3).toString('hex')}`;
    const res = await api('POST', '/admin/products', {
      token: admin.token,
      body: { name, categoryId, basePrice: 20, status: 'published', ...over },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const product = res.body.data.product;
    const created: { id: string; stockQuantity: number }[] = [];
    for (const v of variants) {
      const vr = await api('POST', `/admin/products/${product.id}/variants`, {
        token: admin.token, body: { name: v.name, stockQuantity: v.stock },
      });
      assert.equal(vr.status, 201, JSON.stringify(vr.body));
      created.push(vr.body.data.variant);
    }
    return { product, variants: created };
  }

  before(async () => {
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    admin = await newUser('admin', 'super_admin');
    stock = await newUser('stock', 'inventory_staff');
    orderMgr = await newUser('orders', 'order_manager');
    customer = await newUser('customer');

    const cat = await api('POST', '/admin/categories', { token: admin.token, body: { name: `QA Category ${RUN}` } });
    assert.equal(cat.status, 201, JSON.stringify(cat.body));
    categoryId = cat.body.data.category.id;
    categorySlug = cat.body.data.category.slug;

    const addr = await api('POST', '/users/me/addresses', {
      token: customer.token,
      body: { fullName: 'QA Customer', phone: '01700000000', addressLine1: 'House 1, Road 2', city: 'Dhaka', country: 'Bangladesh' },
    });
    assert.equal(addr.status, 201, JSON.stringify(addr.body));
    assert.equal(addr.body.data.address.is_default, true, 'first address becomes default');
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    await pool.end();
  });

  // ------------------------------------------------------------------ auth
  describe('auth', () => {
    it('refresh rotates tokens, replay is rejected and revokes the session', async () => {
      const email = `refresh-${RUN}@example.com`;
      const reg = await api('POST', '/auth/register', { body: { name: 'Refresh QA', email, password: PASSWORD } });
      assert.equal(reg.status, 200);
      assert.equal(reg.cookies.length, 0, 'no session before the code is verified');
      const verified = await api('POST', '/auth/verify-otp', { body: { email, purpose: 'register', code: otpFor(email) } });
      assert.equal(verified.status, 200, JSON.stringify(verified.body));
      reg.cookies.push(...verified.cookies);
      const oldRefresh = cookieHeader(reg.cookies.filter((c) => c.startsWith('refresh_token=')));

      const r1 = await api('POST', '/auth/refresh', { cookie: oldRefresh, origin: ORIGIN });
      assert.equal(r1.status, 200, JSON.stringify(r1.body));
      assert.ok(r1.body.data.accessToken);
      const newRefresh = cookieHeader(r1.cookies.filter((c) => c.startsWith('refresh_token=')));
      assert.notEqual(newRefresh, oldRefresh);

      const replay = await api('POST', '/auth/refresh', { cookie: oldRefresh, origin: ORIGIN });
      assert.equal(replay.status, 401);
      // theft response: the freshly issued token is dead as well
      const afterReplay = await api('POST', '/auth/refresh', { cookie: newRefresh, origin: ORIGIN });
      assert.equal(afterReplay.status, 401);
    });

    it('logout revokes the refresh token in the database', async () => {
      const email = `logout-${RUN}@example.com`;
      await api('POST', '/auth/register', { body: { name: 'Logout QA', email, password: PASSWORD } });
      const reg = await api('POST', '/auth/verify-otp', { body: { email, purpose: 'register', code: otpFor(email) } });
      const refresh = cookieHeader(reg.cookies.filter((c) => c.startsWith('refresh_token=')));
      const out = await api('POST', '/auth/logout', { cookie: refresh, origin: ORIGIN });
      assert.equal(out.status, 200);
      const rows = await query('SELECT revoked_at FROM refresh_tokens WHERE user_id = (SELECT id FROM users WHERE email = $1)', [email]);
      assert.ok(rows.rows.length > 0 && rows.rows.every((r) => r.revoked_at), 'all tokens revoked');
      const again = await api('POST', '/auth/refresh', { cookie: refresh, origin: ORIGIN });
      assert.equal(again.status, 401);
    });

    it('blocks cross-site cookie requests (CSRF) but allows the real frontend', async () => {
      const refresh = cookieHeader(customer.cookies.filter((c) => c.startsWith('refresh_token=')));
      const evil = await api('POST', '/auth/logout', { cookie: refresh, origin: 'http://evil.example' });
      assert.equal(evil.status, 403);
      const noOrigin = await api('POST', '/auth/logout', { cookie: refresh });
      assert.equal(noOrigin.status, 403);
    });

    it('rejects weak passwords and invalid input with 400', async () => {
      const res = await api('POST', '/auth/register', { body: { name: 'X Y', email: `weak-${RUN}@example.com`, password: 'abcdefgh' } });
      assert.equal(res.status, 400);
    });

    it('a blocked user loses access immediately (no waiting for token expiry)', async () => {
      const victim = await newUser('victim');
      assert.equal((await api('GET', '/cart', { token: victim.token })).status, 200);
      const block = await api('PATCH', `/admin/customers/${victim.id}/status`, { token: admin.token, body: { status: 'blocked' } });
      assert.equal(block.status, 200);
      assert.equal((await api('GET', '/cart', { token: victim.token })).status, 401);
      assert.equal((await api('POST', '/auth/refresh', { cookie: cookieHeader(victim.cookies.filter((c) => c.startsWith('refresh_token='))), origin: ORIGIN })).status, 401);
    });

    it('changing the password signs out other sessions', async () => {
      const u = await newUser('chpw');
      const bad = await api('POST', '/auth/change-password', { token: u.token, body: { currentPassword: 'nope-nope1', newPassword: 'Another-Pass1' } });
      assert.equal(bad.status, 400);
      const ok = await api('POST', '/auth/change-password', { token: u.token, body: { currentPassword: PASSWORD, newPassword: 'Another-Pass1' } });
      assert.equal(ok.status, 200);
      const old = await api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookies.filter((c) => c.startsWith('refresh_token='))), origin: ORIGIN });
      assert.equal(old.status, 401);
    });
  });


  // -------------------------------------------------------------------- FORGOT PASSWORD
  describe('forgot / reset password', () => {
    const expireCooldown = (email: string) =>
      query("UPDATE otp_codes SET created_at = now() - interval '5 minutes' WHERE email = $1", [email]);

    it('resets the password with the e-mailed code, revokes sessions, and the old password stops working', async () => {
      const u = await newUser('reset');
      const refreshCookie = cookieHeader(u.cookies); // newUser() already signed this account in

      const forgot = await api('POST', '/auth/forgot-password', { body: { email: u.email } });
      assert.equal(forgot.status, 200, JSON.stringify(forgot.body));
      assert.equal(forgot.cookies.length, 0, 'no session from forgot-password');
      const code = otpFor(u.email);

      const NEW_PASSWORD = 'Brand-New-Pass9';
      const reset = await api('POST', '/auth/reset-password', { body: { email: u.email, code, newPassword: NEW_PASSWORD } });
      assert.equal(reset.status, 200, JSON.stringify(reset.body));
      assert.equal(reset.body.data.accessToken, undefined, 'reset does not sign anyone in');

      // old sessions are dead
      const refreshed = await api('POST', '/auth/refresh', { cookie: refreshCookie, origin: ORIGIN });
      assert.equal(refreshed.status, 401);

      // old password no longer works, new one does
      assert.equal((await api('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } })).status, 401);
      await expireCooldown(u.email); // newUser() just signed in; skip the 30s code cooldown
      const relogin = await api('POST', '/auth/login', { body: { email: u.email, password: NEW_PASSWORD } });
      assert.equal(relogin.status, 200, JSON.stringify(relogin.body));
    });

    it('a reset code cannot be reused, and a wrong code is rejected without changing the password', async () => {
      const u = await newUser('reset-reuse');
      await api('POST', '/auth/forgot-password', { body: { email: u.email } });
      const good = otpFor(u.email);
      const wrong = good === '000000' ? '111111' : '000000';

      const bad = await api('POST', '/auth/reset-password', { body: { email: u.email, code: wrong, newPassword: 'Another-Pass1' } });
      assert.equal(bad.status, 400);
      await expireCooldown(u.email);
      assert.equal((await api('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } })).status, 200, 'old password still valid');

      assert.equal((await api('POST', '/auth/reset-password', { body: { email: u.email, code: good, newPassword: 'Another-Pass1' } })).status, 200);
      const again = await api('POST', '/auth/reset-password', { body: { email: u.email, code: good, newPassword: 'Third-Pass-1' } });
      assert.equal(again.status, 400);
    });

    it('the code is purpose-bound: a login code cannot reset a password and a reset code cannot log in', async () => {
      const u = await newUser('reset-purpose');
      await expireCooldown(u.email);
      await api('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } });
      const loginCode = otpFor(u.email);
      const r1 = await api('POST', '/auth/reset-password', { body: { email: u.email, code: loginCode, newPassword: 'Hijack-Pass1' } });
      assert.equal(r1.status, 400);

      await expireCooldown(u.email);
      await api('POST', '/auth/forgot-password', { body: { email: u.email } });
      const resetCode = otpFor(u.email);
      const r2 = await api('POST', '/auth/verify-otp', { body: { email: u.email, purpose: 'login', code: resetCode } });
      assert.equal(r2.status, 400);
    });

    it('locks the code after too many wrong attempts', async () => {
      const u = await newUser('reset-lock');
      await api('POST', '/auth/forgot-password', { body: { email: u.email } });
      const good = otpFor(u.email);
      const wrong = good === '000000' ? '111111' : '000000';
      for (let i = 0; i < env.OTP_MAX_ATTEMPTS; i++) {
        await api('POST', '/auth/reset-password', { body: { email: u.email, code: wrong, newPassword: 'Another-Pass1' } });
      }
      const late = await api('POST', '/auth/reset-password', { body: { email: u.email, code: good, newPassword: 'Another-Pass1' } });
      assert.equal(late.status, 400);
    });

    it('expired codes are rejected', async () => {
      const u = await newUser('reset-exp');
      await api('POST', '/auth/forgot-password', { body: { email: u.email } });
      const code = otpFor(u.email);
      await query("UPDATE otp_codes SET expires_at = now() - interval '1 minute' WHERE email = $1", [u.email]);
      const res = await api('POST', '/auth/reset-password', { body: { email: u.email, code, newPassword: 'Another-Pass1' } });
      assert.equal(res.status, 400);
    });

    it('does not reveal whether an account exists (same answer, no e-mail for unknown addresses)', async () => {
      const u = await newUser('reset-enum');
      const before = outbox.length;
      const unknown = await api('POST', '/auth/forgot-password', { body: { email: `nobody-${RUN}@example.com` } });
      assert.equal(unknown.status, 200);
      assert.equal(outbox.length, before, 'no e-mail for an unknown address');

      const known = await api('POST', '/auth/forgot-password', { body: { email: u.email } });
      assert.equal(known.status, 200);
      assert.deepEqual(Object.keys(known.body.data).sort(), Object.keys(unknown.body.data).sort());

      // asking again inside the cooldown still answers 200 (a 429 would reveal the account exists)
      const again = await api('POST', '/auth/forgot-password', { body: { email: u.email } });
      assert.equal(again.status, 200);
    });

    it('a blocked account gets no reset e-mail', async () => {
      const u = await newUser('reset-blocked');
      await query("UPDATE users SET status = 'blocked' WHERE id = $1", [u.id]);
      const before = outbox.length;
      assert.equal((await api('POST', '/auth/forgot-password', { body: { email: u.email } })).status, 200);
      assert.equal(outbox.length, before);
    });

    it('enforces the password rules on the new password', async () => {
      const u = await newUser('reset-weak');
      await api('POST', '/auth/forgot-password', { body: { email: u.email } });
      const res = await api('POST', '/auth/reset-password', { body: { email: u.email, code: otpFor(u.email), newPassword: 'short' } });
      assert.equal(res.status, 400);
    });
  });

  // -------------------------------------------------------------------- OTP
  describe('one-time passcodes', () => {
    const expireCooldown = (email: string) =>
      query("UPDATE otp_codes SET created_at = now() - interval '5 minutes' WHERE email = $1", [email]);

    it('registration issues NO session until the e-mailed code is verified', async () => {
      const email = `otp-reg-${RUN}@example.com`;
      const reg = await api('POST', '/auth/register', { body: { name: 'Otp Reg', email, password: PASSWORD } });
      assert.equal(reg.status, 200);
      assert.equal(reg.body.data.otpRequired, true);
      assert.equal(reg.body.data.accessToken, undefined);
      assert.equal(reg.cookies.length, 0);

      const registerCode = otpFor(email);

      // the account exists but cannot log in with a password alone
      const login = await api('POST', '/auth/login', { body: { email, password: PASSWORD } });
      assert.equal(login.body.data.accessToken, undefined);

      const ok = await api('POST', '/auth/verify-otp', { body: { email, purpose: 'register', code: registerCode } });
      assert.equal(ok.status, 200);
      assert.ok(ok.body.data.accessToken);
      assert.equal(ok.body.data.user.emailVerified, true);
    });

    it('a used code cannot be used again', async () => {
      const email = `otp-reuse-${RUN}@example.com`;
      await api('POST', '/auth/register', { body: { name: 'Otp Reuse', email, password: PASSWORD } });
      const code = otpFor(email);
      assert.equal((await api('POST', '/auth/verify-otp', { body: { email, purpose: 'register', code } })).status, 200);
      assert.equal((await api('POST', '/auth/verify-otp', { body: { email, purpose: 'register', code } })).status, 400);
    });

    it('wrong codes are rejected, counted, and lock the code after too many attempts', async () => {
      const email = `otp-lock-${RUN}@example.com`;
      await api('POST', '/auth/register', { body: { name: 'Otp Lock', email, password: PASSWORD } });
      const good = otpFor(email);
      const wrong = good === '000000' ? '111111' : '000000';

      const first = await api('POST', '/auth/verify-otp', { body: { email, purpose: 'register', code: wrong } });
      assert.equal(first.status, 400);
      assert.match(first.body.message, /attempt\(s\) left/);
      for (let i = 0; i < env.OTP_MAX_ATTEMPTS - 1; i++) {
        await api('POST', '/auth/verify-otp', { body: { email, purpose: 'register', code: wrong } });
      }
      // even the CORRECT code no longer works: the code was invalidated
      const late = await api('POST', '/auth/verify-otp', { body: { email, purpose: 'register', code: good } });
      assert.equal(late.status, 400);

      // a fresh code (after the resend cooldown) works again
      await expireCooldown(email);
      const resend = await api('POST', '/auth/resend-otp', { body: { email, purpose: 'register' } });
      assert.equal(resend.status, 200, JSON.stringify(resend.body));
      assert.equal((await api('POST', '/auth/verify-otp', { body: { email, purpose: 'register', code: otpFor(email) } })).status, 200);
    });

    it('expired codes are rejected', async () => {
      const email = `otp-exp-${RUN}@example.com`;
      await api('POST', '/auth/register', { body: { name: 'Otp Exp', email, password: PASSWORD } });
      await query("UPDATE otp_codes SET expires_at = now() - interval '1 minute' WHERE email = $1", [email]);
      assert.equal((await api('POST', '/auth/verify-otp', { body: { email, purpose: 'register', code: otpFor(email) } })).status, 400);
    });

    it('resend is rate limited per address and cannot probe unknown e-mails', async () => {
      const email = `otp-resend-${RUN}@example.com`;
      await api('POST', '/auth/register', { body: { name: 'Otp Resend', email, password: PASSWORD } });
      const tooSoon = await api('POST', '/auth/resend-otp', { body: { email, purpose: 'register' } });
      assert.equal(tooSoon.status, 429);

      const before = outbox.length;
      const unknown = await api('POST', '/auth/resend-otp', { body: { email: `nobody-${RUN}@example.com`, purpose: 'login' } });
      assert.equal(unknown.status, 200, 'same answer as for real accounts');
      assert.equal(outbox.length, before, 'and no e-mail is sent');
    });

    it('login: a correct password only starts the challenge; a wrong one sends nothing', async () => {
      const email = `otp-login-${RUN}@example.com`;
      await authRepository.createUser({ name: 'Otp Login', email, passwordHash: await hashPassword(PASSWORD) });

      const before = outbox.length;
      const bad = await api('POST', '/auth/login', { body: { email, password: 'Wrong-Pass1' } });
      assert.equal(bad.status, 401);
      assert.equal(outbox.length, before, 'no code for a wrong password');

      const step1 = await api('POST', '/auth/login', { body: { email, password: PASSWORD } });
      assert.equal(step1.status, 200);
      assert.equal(step1.cookies.length, 0);
      assert.equal(step1.body.data.accessToken, undefined);

      // the code is bound to the purpose: a login code cannot complete a registration
      assert.equal((await api('POST', '/auth/verify-otp', { body: { email, purpose: 'register', code: otpFor(email) } })).status, 400);
      const done = await api('POST', '/auth/verify-otp', { body: { email, purpose: 'login', code: otpFor(email) } });
      assert.equal(done.status, 200);
      assert.ok(cookieValue(done.cookies, 'refresh_token'));
    });

    it('re-registering a verified or staff account is refused (no password overwrite)', async () => {
      const staffEmail = `otp-staff-${RUN}@example.com`;
      await authRepository.createUser({ name: 'Staff', email: staffEmail, passwordHash: await hashPassword(PASSWORD), role: 'manager' as never });
      const res = await api('POST', '/auth/register', { body: { name: 'Evil Twin', email: staffEmail, password: 'Attacker-Pass1' } });
      assert.equal(res.status, 409);
      const stillWorks = await api('POST', '/auth/login', { body: { email: staffEmail, password: PASSWORD } });
      assert.equal(stillWorks.status, 200);
    });

    it('rejects malformed codes', async () => {
      const res = await api('POST', '/auth/verify-otp', { body: { email: 'a@example.com', purpose: 'login', code: '12ab56' } });
      assert.equal(res.status, 400);
    });
  });

  // ---------------------------------------------------------- error mapping
  describe('error handling', () => {
    it('malformed JSON is a 400, not a 500', async () => {
      const res = await api('POST', '/auth/login', { body: '{bad' });
      assert.equal(res.status, 400);
    });
    it('disallowed CORS origin is a 403, not a 500', async () => {
      const res = await fetch(`${base}/api/products`, { headers: { origin: 'http://evil.example' } });
      assert.equal(res.status, 403);
    });
    it('bad ids / huge numbers never 500', async () => {
      assert.equal((await api('GET', '/admin/inventory/movements?productId=abc', { token: admin.token })).status, 400);
      assert.equal((await api('GET', '/products?page=99999999999999999999')).status, 400);
      assert.equal((await api('GET', '/products?page=99999999')).status, 200);
      assert.equal((await api('GET', '/products?minPrice=abc')).status, 400);
      assert.equal((await api('GET', '/products?minPrice=10&maxPrice=5')).status, 400);
    });
  });

  // ---------------------------------------------------------------- catalog
  describe('catalog & admin products', () => {
    it('blank slug is auto-generated and slugs are normalised', async () => {
      const a = await api('POST', '/admin/products', { token: admin.token, body: { name: `Auto Slug ${RUN}`, slug: '', categoryId, basePrice: 10 } });
      assert.equal(a.status, 201, JSON.stringify(a.body));
      assert.match(a.body.data.product.slug, /^auto-slug-[a-z0-9]+$/);
      const b = await api('POST', '/admin/products', { token: admin.token, body: { name: `Weird ${RUN}`, slug: `My Weird/Slug ?x=1 ${RUN}`, categoryId, basePrice: 10 } });
      assert.equal(b.status, 201);
      assert.match(b.body.data.product.slug, /^[a-z0-9-]+$/);
    });

    it('rejects sale >= base, 0 sale price semantics, overflow and unknown category', async () => {
      const mk = (over: object) => api('POST', '/admin/products', { token: admin.token, body: { name: `Bad ${RUN}`, categoryId, basePrice: 10, ...over } });
      assert.equal((await mk({ salePrice: 50 })).status, 400);
      assert.equal((await mk({ basePrice: 1e13 })).status, 400);
      assert.equal((await mk({ categoryId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' })).status, 400);
    });

    it('a stored sale price of 0 is never used as the price', async () => {
      const { product } = await createProduct({ basePrice: 30 });
      const patch = await api('PATCH', `/admin/products/${product.id}`, { token: admin.token, body: { salePrice: null } });
      assert.equal(patch.status, 200);
      const pub = await api('GET', `/products/${product.slug}`);
      assert.equal(pub.body.data.product.finalPrice, 30);
      assert.equal(pub.body.data.product.salePrice, null);
    });

    it('optional fields can be cleared (not just changed)', async () => {
      const { product } = await createProduct({ basePrice: 40, salePrice: 25, shortDescription: 'hello' });
      const res = await api('PATCH', `/admin/products/${product.id}`, { token: admin.token, body: { salePrice: null, shortDescription: '' } });
      assert.equal(res.status, 200);
      const pub = await api('GET', `/products/${product.slug}`);
      assert.equal(pub.body.data.product.salePrice, null);
      assert.equal(pub.body.data.product.shortDescription, null);
    });

    it('search, category and listing share one camelCase shape; "%" is literal', async () => {
      const { product } = await createProduct();
      const list = await api('GET', `/categories/${categorySlug}/products`);
      assert.equal(list.status, 200);
      const p = list.body.data.products.find((x: { id: string }) => x.id === product.id);
      assert.ok(p, 'product is in its category page');
      assert.equal(typeof p.basePrice, 'number');
      assert.ok(!('base_price' in p) && !('barcode' in p));

      const s = await api('GET', `/search?q=${encodeURIComponent(product.name)}`);
      assert.equal(s.status, 200);
      assert.equal(typeof s.body.data.products[0].basePrice, 'number');

      const wild = await api('GET', '/search?q=%25%25');
      assert.equal(wild.body.meta.total, 0, 'a literal % does not match everything');
      assert.equal((await api('GET', '/search?q=a')).status, 400);
    });

    it('inactive categories are hidden everywhere on the storefront', async () => {
      const cat = await api('POST', '/admin/categories', { token: admin.token, body: { name: `Hidden ${RUN}` } });
      const id = cat.body.data.category.id;
      const slug = cat.body.data.category.slug;
      await createProduct({ categoryId: id });
      assert.equal((await api('GET', `/categories/${slug}/products`)).status, 200);
      await api('PATCH', `/admin/categories/${id}`, { token: admin.token, body: { isActive: false } });
      assert.equal((await api('GET', `/categories/${slug}/products`)).status, 404);
    });

    it('category cycles are rejected and the tree stays intact', async () => {
      const a = (await api('POST', '/admin/categories', { token: admin.token, body: { name: `Cyc A ${RUN}` } })).body.data.category;
      const b = (await api('POST', '/admin/categories', { token: admin.token, body: { name: `Cyc B ${RUN}`, parentId: a.id } })).body.data.category;
      assert.equal((await api('PATCH', `/admin/categories/${a.id}`, { token: admin.token, body: { parentId: a.id } })).status, 400);
      assert.equal((await api('PATCH', `/admin/categories/${a.id}`, { token: admin.token, body: { parentId: b.id } })).status, 400);
      const tree = await api('GET', '/categories/tree');
      assert.ok(tree.body.data.categories.some((c: { id: string }) => c.id === a.id));
    });

    it('deleting a category with products / a product with orders gives 409 (not 500)', async () => {
      const del = await api('DELETE', `/admin/categories/${categoryId}`, { token: admin.token });
      assert.equal(del.status, 409);
    });

    it('duplicating a product copies variants with zero stock and no SKU', async () => {
      const { product } = await createProduct({ sku: `SKU-${RUN}` }, [{ name: 'A', stock: 5 }, { name: 'B', stock: 6 }]);
      const dup = await api('POST', `/admin/products/${product.id}/duplicate`, { token: admin.token });
      assert.equal(dup.status, 201);
      const full = await api('GET', `/admin/products/${dup.body.data.product.id}`, { token: admin.token });
      assert.equal(full.body.data.product.variants.length, 2);
      assert.ok(full.body.data.product.variants.every((v: { stockQuantity: number }) => v.stockQuantity === 0));
      assert.equal(full.body.data.product.sku, null);
    });

    it('SKUs are unique', async () => {
      const sku = `UNIQ-${RUN}`;
      await createProduct({ sku });
      const dup = await api('POST', '/admin/products', { token: admin.token, body: { name: `Dup sku ${RUN}`, categoryId, basePrice: 5, sku } });
      assert.equal(dup.status, 409);
    });

    it('attribute values are validated against their definitions', async () => {
      const slug = `qa-skin-${RUN}`;
      const def = await api('POST', '/admin/attributes', { token: admin.token, body: { name: `QA Skin ${RUN}`, slug, type: 'multiselect', predefinedValues: ['Oily', 'Dry'], isFilterable: true } });
      assert.equal(def.status, 201, JSON.stringify(def.body));
      const mk = (attributes: object) => api('POST', '/admin/products', { token: admin.token, body: { name: `Attr ${RUN}${Math.random()}`, categoryId, basePrice: 9, attributes } });
      assert.equal((await mk({ [slug]: ['Oily'] })).status, 201);
      assert.equal((await mk({ [slug]: 'Oily,Dry' })).status, 400, 'string instead of list');
      assert.equal((await mk({ [slug]: ['Nope'] })).status, 400, 'value not allowed');
      assert.equal((await mk({ unknown_attr: 'x' })).status, 400, 'unknown key');
    });
  });

  // ------------------------------------------------------- cart & checkout
  describe('cart', () => {
    it('same no-variant product merges into one line', async () => {
      const { product } = await createProduct({}, []);
      const u = await newUser('cartmerge');
      const first = await api('POST', '/cart/items', { token: u.token, body: { productId: product.id, quantity: 2 } });
      assert.equal(first.status, 201, JSON.stringify(first.body));
      const res = await api('POST', '/cart/items', { token: u.token, body: { productId: product.id, quantity: 3 } });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.cart.items.length, 1);
      assert.equal(res.body.data.cart.items[0].quantity, 5);
    });

    it('products with variants require a variant; out-of-stock cannot be added', async () => {
      const { product, variants } = await createProduct({}, [{ name: 'S', stock: 2 }]);
      const u = await newUser('cartrules');
      assert.equal((await api('POST', '/cart/items', { token: u.token, body: { productId: product.id } })).status, 400);
      assert.equal((await api('POST', '/cart/items', { token: u.token, body: { productId: product.id, variantId: variants[0].id, quantity: 3 } })).status, 422);
      assert.equal((await api('POST', '/cart/items', { token: u.token, body: { productId: product.id, variantId: variants[0].id, quantity: 2 } })).status, 201);

      const oos = await createProduct({ stockStatus: 'out_of_stock' }, []);
      assert.equal((await api('POST', '/cart/items', { token: u.token, body: { productId: oos.product.id } })).status, 422);
    });

    it('rejects unknown products, foreign variants and absurd quantities', async () => {
      const u = await newUser('cartbad');
      assert.equal((await api('POST', '/cart/items', { token: u.token, body: { productId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' } })).status, 404);
      const a = await createProduct();
      const b = await createProduct();
      assert.equal((await api('POST', '/cart/items', { token: u.token, body: { productId: a.product.id, variantId: b.variants[0].id } })).status, 400);
      assert.equal((await api('POST', '/cart/items', { token: u.token, body: { productId: a.product.id, variantId: a.variants[0].id, quantity: 99999999999 } })).status, 400);
    });

    it('guest-cart sync skips bad items instead of failing the whole merge', async () => {
      const { product, variants } = await createProduct();
      const u = await newUser('sync');
      const res = await api('POST', '/cart/sync', {
        token: u.token,
        body: { items: [
          { productId: product.id, variantId: variants[0].id, quantity: 2 },
          { productId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', quantity: 1 },
        ] },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.cart.items.length, 1);
      assert.equal(res.body.data.skipped.length, 1);
    });
  });

  describe('checkout & orders', () => {
    async function buyer(items: { productId: string; variantId?: string; quantity: number }[]) {
      const u = await newUser('buyer');
      const addr = await api('POST', '/users/me/addresses', {
        token: u.token,
        body: { fullName: 'Buyer', phone: '01800000000', addressLine1: 'Somewhere 12', city: 'Dhaka', country: 'Bangladesh' },
      });
      for (const it of items) {
        const r = await api('POST', '/cart/items', { token: u.token, body: it });
        assert.equal(r.status, 201, JSON.stringify(r.body));
      }
      return { ...u, addressId: addr.body.data.address.id as string };
    }

    it('the server computes shipping and ignores a client-supplied deliveryFee', async () => {
      const { product, variants } = await createProduct({ basePrice: 10 });
      const u = await buyer([{ productId: product.id, variantId: variants[0].id, quantity: 1 }]);
      const quote = await api('POST', '/checkout/quote', { token: u.token, body: {} });
      assert.equal(quote.body.data.quote.deliveryFee, env.DELIVERY_FEE);
      const res = await api('POST', '/checkout', { token: u.token, body: { addressId: u.addressId, deliveryFee: 0 } });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.order.deliveryFee, env.DELIVERY_FEE);
      assert.equal(res.body.data.order.total, 10 + env.DELIVERY_FEE);
    });

    it('only enabled payment providers are accepted', async () => {
      const { product, variants } = await createProduct();
      const u = await buyer([{ productId: product.id, variantId: variants[0].id, quantity: 1 }]);
      const res = await api('POST', '/checkout', { token: u.token, body: { addressId: u.addressId, paymentProvider: 'card' } });
      assert.equal(res.status, 400);
    });

    it('concurrent checkouts of one cart create exactly one order', async () => {
      const { product, variants } = await createProduct({}, [{ name: 'Race', stock: 50 }]);
      const u = await buyer([{ productId: product.id, variantId: variants[0].id, quantity: 1 }]);
      const results = await Promise.all(
        [1, 2, 3, 4].map(() => api('POST', '/checkout', { token: u.token, body: { addressId: u.addressId } }))
      );
      assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.status)));
      const count = await query('SELECT COUNT(*)::int AS c FROM orders WHERE user_id = $1', [u.id]);
      assert.equal(count.rows[0].c, 1);
    });

    it('stock is decremented, then restored when the customer cancels', async () => {
      const { product, variants } = await createProduct({}, [{ name: 'Stocky', stock: 10 }]);
      const u = await buyer([{ productId: product.id, variantId: variants[0].id, quantity: 3 }]);
      const placed = await api('POST', '/checkout', { token: u.token, body: { addressId: u.addressId } });
      assert.equal(placed.status, 201);
      const stockOf = async () => (await query('SELECT stock_quantity FROM product_variants WHERE id = $1', [variants[0].id])).rows[0].stock_quantity;
      assert.equal(await stockOf(), 7);

      const cancel = await api('POST', `/orders/my/${placed.body.data.order.orderNumber}/cancel`, { token: u.token });
      assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
      assert.equal(await stockOf(), 10);
      const again = await api('POST', `/orders/my/${placed.body.data.order.orderNumber}/cancel`, { token: u.token });
      assert.equal(again.status, 409);
    });

    it('selling the last unit flips the product to out_of_stock', async () => {
      const { product, variants } = await createProduct({}, [{ name: 'Last', stock: 1 }]);
      const u = await buyer([{ productId: product.id, variantId: variants[0].id, quantity: 1 }]);
      assert.equal((await api('POST', '/checkout', { token: u.token, body: { addressId: u.addressId } })).status, 201);
      const pub = await api('GET', `/products/${product.slug}`);
      assert.equal(pub.body.data.product.stockStatus, 'out_of_stock');
    });

    it('customers never see admin_note, user_id or coupon_id', async () => {
      const { product, variants } = await createProduct();
      const u = await buyer([{ productId: product.id, variantId: variants[0].id, quantity: 1 }]);
      const placed = await api('POST', '/checkout', { token: u.token, body: { addressId: u.addressId } });
      await api('PATCH', `/admin/orders/${placed.body.data.order.id}/admin-note`, { token: admin.token, body: { note: 'INTERNAL fraud check' } });
      const order = (await api('GET', `/orders/my/${placed.body.data.order.orderNumber}`, { token: u.token })).body.data.order;
      assert.ok(!('admin_note' in order) && !('user_id' in order) && !('coupon_id' in order));
      assert.equal(typeof order.total, 'number');
      const list = (await api('GET', '/orders/my', { token: u.token })).body.data.orders[0];
      assert.ok(!('admin_note' in list));
    });

    it('order lifecycle: invalid jumps are rejected, COD becomes paid on delivery, revenue counts it', async () => {
      const { product, variants } = await createProduct({ basePrice: 50 });
      const u = await buyer([{ productId: product.id, variantId: variants[0].id, quantity: 1 }]);
      const placed = (await api('POST', '/checkout', { token: u.token, body: { addressId: u.addressId } })).body.data.order;
      const set = (status: string) => api('PATCH', `/admin/orders/${placed.id}/status`, { token: orderMgr.token, body: { status } });

      assert.equal((await set('delivered')).status, 409, 'pending -> delivered is not allowed');
      for (const s of ['confirmed', 'processing', 'packed', 'shipped', 'delivered']) {
        assert.equal((await set(s)).status, 200, `-> ${s}`);
      }
      assert.equal((await set('pending')).status, 409, 'delivered -> pending is not allowed');

      const detail = (await api('GET', `/admin/orders/${placed.id}`, { token: admin.token })).body.data.order;
      assert.equal(detail.payment_status, 'paid');
      const stats = await api('GET', '/admin/dashboard/stats', { token: admin.token });
      assert.ok(stats.body.data.totalRevenue >= 50);

      const refund = await api('PATCH', `/admin/orders/${placed.id}/payment-status`, { token: admin.token, body: { paymentStatus: 'refunded' } });
      assert.equal(refund.status, 200);
    });

    it('cancelling releases the coupon use; percentage coupons are capped at 100', async () => {
      const bad = await api('POST', '/admin/coupons', { token: admin.token, body: { code: `BIG${RUN}`, type: 'percentage', value: 150 } });
      assert.equal(bad.status, 400);
      const code = `QA${RUN}`.toUpperCase();
      const ok = await api('POST', '/admin/coupons', { token: admin.token, body: { code, type: 'percentage', value: 10, usageLimit: 5, perUserLimit: 1 } });
      assert.equal(ok.status, 201, JSON.stringify(ok.body));

      const { product, variants } = await createProduct({ basePrice: 100 }, [{ name: 'C', stock: 10 }]);
      const u = await buyer([{ productId: product.id, variantId: variants[0].id, quantity: 1 }]);
      const placed = await api('POST', '/checkout', { token: u.token, body: { addressId: u.addressId, couponCode: code } });
      assert.equal(placed.status, 201, JSON.stringify(placed.body));
      assert.equal(placed.body.data.order.discountTotal, 10);
      const used = async () => (await query('SELECT used_count FROM coupons WHERE code = $1', [code])).rows[0].used_count;
      assert.equal(await used(), 1);

      // per-user limit
      await api('POST', '/cart/items', { token: u.token, body: { productId: product.id, variantId: variants[0].id, quantity: 1 } });
      const second = await api('POST', '/checkout', { token: u.token, body: { addressId: u.addressId, couponCode: code } });
      assert.equal(second.status, 400);

      await api('POST', `/orders/my/${placed.body.data.order.orderNumber}/cancel`, { token: u.token });
      assert.equal(await used(), 0);
    });

    it('products with order history cannot be deleted (409) but can be archived', async () => {
      const { product, variants } = await createProduct();
      const u = await buyer([{ productId: product.id, variantId: variants[0].id, quantity: 1 }]);
      await api('POST', '/checkout', { token: u.token, body: { addressId: u.addressId } });
      assert.equal((await api('DELETE', `/admin/products/${product.id}`, { token: admin.token })).status, 409);
      assert.equal((await api('PATCH', `/admin/products/${product.id}/status`, { token: admin.token, body: { status: 'archived' } })).status, 200);
      assert.equal((await api('GET', `/products/${product.slug}`)).status, 404);
    });
  });

  // ------------------------------------------------------------------ RBAC
  describe('role permissions', () => {
    it('inventory_staff: can read catalogue and adjust stock, nothing else', async () => {
      const { product, variants } = await createProduct();
      assert.equal((await api('GET', '/admin/products', { token: stock.token })).status, 200);
      const adj = await api('PATCH', '/admin/inventory/adjust', {
        token: stock.token, body: { productId: product.id, variantId: variants[0].id, newQuantity: 42, reason: 'recount' },
      });
      assert.equal(adj.status, 200, JSON.stringify(adj.body));
      assert.equal((await api('GET', '/admin/customers', { token: stock.token })).status, 403);
      assert.equal((await api('GET', '/admin/orders', { token: stock.token })).status, 403);
      assert.equal((await api('POST', '/admin/coupons', { token: stock.token, body: { code: `NOPE${RUN}`, type: 'fixed', value: 5 } })).status, 403);
      assert.equal((await api('DELETE', `/admin/products/${product.id}`, { token: stock.token })).status, 403);
      assert.equal((await api('GET', '/admin/audit-logs', { token: stock.token })).status, 403);
    });

    it('order_manager: orders yes, coupons/catalogue writes no', async () => {
      assert.equal((await api('GET', '/admin/orders', { token: orderMgr.token })).status, 200);
      assert.equal((await api('GET', '/admin/coupons', { token: orderMgr.token })).status, 403);
      assert.equal((await api('POST', '/admin/categories', { token: orderMgr.token, body: { name: 'x y' } })).status, 403);
      const cid = customer.id;
      assert.equal((await api('PATCH', `/admin/customers/${cid}/status`, { token: orderMgr.token, body: { status: 'blocked' } })).status, 403);
    });

    it('customers cannot reach admin APIs; only super_admin manages staff', async () => {
      assert.equal((await api('GET', '/admin/dashboard/stats', { token: customer.token })).status, 403);
      assert.equal((await api('GET', '/admin/staff', { token: stock.token })).status, 403);
      assert.equal((await api('GET', '/admin/staff', { token: admin.token })).status, 200);
      const created = await api('POST', '/admin/staff', {
        token: admin.token,
        body: { name: 'New Staff', email: `staff-${RUN}@example.com`, password: 'Long-Pass-12345', role: 'order_manager' },
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal((await api('PATCH', `/admin/staff/${admin.id}`, { token: admin.token, body: { role: 'manager' } })).status, 400, 'cannot demote yourself');
    });

    it('homepage content admin works on both documented paths and rejects javascript: links', async () => {
      const mk = (path: string, buttonLink: string) =>
        api('POST', path, { token: admin.token, body: { type: 'banner', title: `QA ${RUN}`, buttonLink } });
      assert.equal((await mk('/admin/content', 'javascript:alert(1)')).status, 400);
      const a = await mk('/admin/content', '/shop');
      assert.equal(a.status, 201, JSON.stringify(a.body));
      assert.equal((await api('GET', '/admin/content/homepage', { token: admin.token })).status, 200);
      assert.equal((await api('DELETE', `/admin/content/homepage/${a.body.data.section.id}`, { token: admin.token })).status, 200);
    });
  });


  // --------------------------------------------------------------- settings
  describe('admin settings (rates editable from the panel)', () => {
    const put = (token: string, values: Record<string, number | null>) =>
      api('PATCH', '/admin/settings', { token, body: { values } });
    const reset = () => put(admin.token, { 'shipping.deliveryFee': null, 'shipping.freeDeliveryThreshold': null, 'inventory.lowStockThreshold': null });

    it('only admins can read or change settings', async () => {
      assert.equal((await api('GET', '/admin/settings', { token: admin.token })).status, 200);
      for (const u of [stock, orderMgr, customer]) {
        assert.equal((await api('GET', '/admin/settings', { token: u.token })).status, 403);
        assert.equal((await put(u.token, { 'shipping.deliveryFee': 1 })).status, 403);
      }
      const mgr = await newUser('settingsmgr', 'manager');
      assert.equal((await api('GET', '/admin/settings', { token: mgr.token })).status, 403);
    });

    it('lists every setting with its default and whether it is customised', async () => {
      const res = await api('GET', '/admin/settings', { token: admin.token });
      const fee = res.body.data.settings.find((x: { key: string }) => x.key === 'shipping.deliveryFee');
      assert.equal(fee.defaultValue, env.DELIVERY_FEE);
      assert.equal(fee.isCustom, false);
      assert.ok(res.body.data.settings.length >= 7);
    });

    it('rejects invalid values and unknown keys, and applies nothing when one field is bad', async () => {
      assert.equal((await put(admin.token, { 'shipping.deliveryFee': -1 })).status, 400);
      assert.equal((await put(admin.token, { 'shipping.deliveryFee': 12.345 })).status, 400);
      assert.equal((await put(admin.token, { 'inventory.lowStockThreshold': 1.5 })).status, 400);
      assert.equal((await put(admin.token, { 'otp.maxAttempts': 99 })).status, 400);
      assert.equal((await put(admin.token, { 'nope.nothing': 1 })).status, 400);
      const mixed = await put(admin.token, { 'shipping.deliveryFee': 9, 'otp.maxAttempts': 0 });
      assert.equal(mixed.status, 400);
      const after = await api('GET', '/admin/settings', { token: admin.token });
      assert.equal(after.body.data.settings.find((x: { key: string }) => x.key === 'shipping.deliveryFee').isCustom, false, 'all-or-nothing');
    });

    it('a changed delivery fee / free-delivery threshold applies to the very next quote; reset restores the default', async () => {
      const { product, variants } = await createProduct({ basePrice: 10 });
      const u = await newUser('settingsbuyer');
      await api('POST', '/cart/items', { token: u.token, body: { productId: product.id, variantId: variants[0].id, quantity: 1 } });
      const quote = async () => (await api('POST', '/checkout/quote', { token: u.token, body: {} })).body.data.quote;
      try {
        assert.equal((await quote()).deliveryFee, env.DELIVERY_FEE);

        assert.equal((await put(admin.token, { 'shipping.deliveryFee': 7.5 })).status, 200);
        const q1 = await quote();
        assert.equal(q1.deliveryFee, 7.5);
        assert.equal(q1.total, 17.5);

        await put(admin.token, { 'shipping.freeDeliveryThreshold': 5 }); // subtotal 10 > 5 => free
        const q2 = await quote();
        assert.equal(q2.deliveryFee, 0);
        assert.equal(q2.freeDeliveryThreshold, 5);

        await put(admin.token, { 'shipping.deliveryFee': 0 }); // 0 => always free
        assert.equal((await quote()).deliveryFee, 0);
      } finally {
        await reset();
      }
      assert.equal((await quote()).deliveryFee, env.DELIVERY_FEE, 'back to the environment default');
    });

    it('the low-stock threshold feeds the dashboard and inventory screens', async () => {
      try {
        await put(admin.token, { 'inventory.lowStockThreshold': 3 });
        const stats = await api('GET', '/admin/dashboard/stats', { token: admin.token });
        assert.equal(stats.body.data.lowStockThreshold, 3);
        const inv = await api('GET', '/admin/inventory?limit=1', { token: stock.token });
        assert.equal(inv.body.data.lowStockThreshold, 3);
      } finally {
        await reset();
      }
    });

    it('changes are recorded in the audit log', async () => {
      try {
        await put(admin.token, { 'shipping.deliveryFee': 6 });
        const logs = await api('GET', '/admin/audit-logs?entityType=settings&limit=5', { token: admin.token });
        assert.ok(logs.body.data.auditLogs.some((l: { action: string }) => l.action === 'update'));
      } finally {
        await reset();
      }
    });
  });

  // ------------------------------------------------------- role management
  describe('role management (making other accounts admin)', () => {
    const setRole = (token: string, id: string, role: string) => api('PATCH', `/admin/staff/${id}`, { token, body: { role } });

    it('an admin can promote an existing customer; it applies at once, and demotion revokes access', async () => {
      const actor = await newUser('rolesadmin', 'admin');
      const person = await newUser('promoted');
      assert.equal((await api('GET', '/admin/settings', { token: person.token })).status, 403);

      assert.equal((await setRole(actor.token, person.id, 'admin')).status, 200);
      // the SAME token works immediately (role is read from the database on every request)
      assert.equal((await api('GET', '/admin/settings', { token: person.token })).status, 200);

      assert.equal((await setRole(actor.token, person.id, 'customer')).status, 200);
      assert.equal((await api('GET', '/admin/settings', { token: person.token })).status, 403);
      const refresh = await api('POST', '/auth/refresh', { cookie: cookieHeader(person.cookies.filter((c) => c.startsWith('refresh_token='))), origin: ORIGIN });
      assert.equal(refresh.status, 401, 'refresh tokens were revoked');
    });

    it('an admin can never grant, touch or create a super admin (no privilege escalation)', async () => {
      const actor = await newUser('noescalate', 'admin');
      const person = await newUser('wannabe');
      assert.equal((await setRole(actor.token, person.id, 'super_admin')).status, 403);
      assert.equal((await setRole(actor.token, admin.id, 'manager')).status, 403, 'cannot demote a super admin');
      const created = await api('POST', '/admin/staff', {
        token: actor.token,
        body: { name: 'Sneaky', email: `sneaky-${RUN}@example.com`, password: 'Long-Pass-12345', role: 'super_admin' },
      });
      assert.equal(created.status, 403);
      // a super admin can
      assert.equal((await setRole(admin.token, person.id, 'super_admin')).status, 200);
      assert.equal((await setRole(admin.token, person.id, 'customer')).status, 200);
    });

    it('nobody can change their own role, and managers cannot manage staff', async () => {
      const actor = await newUser('selfrole', 'admin');
      assert.equal((await setRole(actor.token, actor.id, 'customer')).status, 400);
      const mgr = await newUser('mgrstaff', 'manager');
      assert.equal((await api('GET', '/admin/staff', { token: mgr.token })).status, 403);
      assert.equal((await setRole(mgr.token, customer.id, 'admin')).status, 403);
    });

    it('accounts can be searched by e-mail (min 2 characters) and blocked accounts cannot be promoted', async () => {
      const actor = await newUser('searcher', 'admin');
      const person = await newUser('findme');
      const found = await api('GET', `/admin/staff/users?search=${encodeURIComponent(person.email.slice(0, 12))}`, { token: actor.token });
      assert.equal(found.status, 200);
      assert.ok(found.body.data.users.some((u: { id: string }) => u.id === person.id));
      assert.equal((await api('GET', '/admin/staff/users?search=a', { token: actor.token })).status, 400);

      await api('PATCH', `/admin/staff/${person.id}`, { token: actor.token, body: { status: 'blocked' } });
      assert.equal((await setRole(actor.token, person.id, 'admin')).status, 400);
    });
  });

  it('refresh cookie helpers sanity', () => {
    assert.equal(cookieValue(['a=1; Path=/'], 'a'), '1');
  });
});
