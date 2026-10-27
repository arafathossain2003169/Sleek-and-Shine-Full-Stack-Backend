/**
 * Proves the e-mail path with a REAL SMTP conversation (an in-process SMTP server that requires a login):
 *  - the OTP e-mail is delivered and the code inside it verifies the account,
 *  - when the mail server is unreachable the API answers 503 (not 500) and nothing is left blocking a retry.
 * Needs the same database variables as the main suite.
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { SMTPServer } from 'smtp-server';
import { simpleParser, ParsedMail } from 'mailparser';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

describe('OTP e-mail over real SMTP', () => {
  const received: ParsedMail[] = [];
  let smtp: SMTPServer;
  let smtpPort = 0;
  let server: Server;
  let base = '';
  let pool: { end: () => Promise<void>; query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
  let verifyMailTransport: () => Promise<{ ok: boolean; detail: string }>;

  const api = async (path: string, body: unknown) => {
    const res = await fetch(`${base}/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const startSmtp = () =>
    new Promise<void>((resolve) => {
      smtp = new SMTPServer({
        authOptional: false,
        allowInsecureAuth: true,
        disabledCommands: ['STARTTLS'],
        onAuth(auth, _session, cb) {
          if (auth.username === 'mailer' && auth.password === 'secret') cb(null, { user: 'mailer' });
          else cb(new Error('Invalid login'));
        },
        onData(stream, _session, cb) {
          simpleParser(stream).then((m) => { received.push(m); cb(); }).catch(cb);
        },
      });
      smtp.listen(smtpPort, '127.0.0.1', () => resolve());
    });

  before(async () => {
    smtpPort = await freePort();
    // configure BEFORE the app modules are imported (env.ts reads these once)
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(smtpPort);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_USER = 'mailer';
    process.env.SMTP_PASS = 'secret';
    process.env.MAIL_FROM = 'SleeknShine <no-reply@test.local>';

    const { createApp } = await import('../src/app');
    pool = (await import('../src/config/db')).pool as never;
    verifyMailTransport = (await import('../src/modules/otp/mail.service')).verifyMailTransport;
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    await new Promise((r) => (smtp ? smtp.close(() => r(null)) : r(null)));
    await pool.end();
  });

  const email = `smtp-${Date.now()}@example.com`;
  const credentials = { name: 'Smtp Test', email, password: 'Passw0rd-QA' };

  it('mail server down: registration answers 503 (not 500) and leaves nothing blocking an immediate retry', async () => {
    const down = await verifyMailTransport();
    assert.equal(down.ok, false);

    const res = await api('/auth/register', credentials);
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.match(res.body.message, /could not send the verification email/i);

    const rows = await pool.query('SELECT 1 FROM otp_codes WHERE email = $1', [email]);
    assert.equal(rows.rows.length, 0, 'the undelivered code was removed');
  });

  it('mail server up: the e-mail arrives over SMTP and the code inside verifies the account', async () => {
    await startSmtp();
    assert.equal((await verifyMailTransport()).ok, true, 'connects and authenticates');

    // immediate retry works: no cooldown was charged for the failed attempt
    const reg = await api('/auth/register', credentials);
    assert.equal(reg.status, 200, JSON.stringify(reg.body));
    assert.equal(reg.body.data.otpRequired, true);

    assert.equal(received.length, 1, 'exactly one e-mail was delivered');
    const mail = received[0];
    assert.equal(mail.to && 'value' in mail.to ? mail.to.value[0].address : '', email);
    assert.equal(mail.from?.value[0].address, 'no-reply@test.local');
    assert.match(mail.subject ?? '', /verification code/i);
    assert.ok(mail.html, 'has an HTML part');

    const code = /\b(\d{6})\b/.exec(mail.text ?? '')?.[1];
    assert.ok(code, 'the text part contains the 6-digit code');

    const wrong = await api('/auth/verify-otp', { email, purpose: 'register', code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.status, 400);
    const ok = await api('/auth/verify-otp', { email, purpose: 'register', code });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.user.emailVerified, true);
  });

  it('login sends a fresh e-mail with its own code', async () => {
    await pool.query("UPDATE otp_codes SET created_at = now() - interval '5 minutes' WHERE email = $1", [email]);
    const before = received.length;
    const login = await api('/auth/login', { email, password: credentials.password });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.equal(received.length, before + 1);
    const code = /\b(\d{6})\b/.exec(received[received.length - 1].text ?? '')?.[1];
    assert.equal((await api('/auth/verify-otp', { email, purpose: 'login', code })).status, 200);
  });
});
