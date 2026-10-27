import { createApp } from './app';
import { env } from './config/env';
import { checkDbConnection, pool } from './config/db';
import { authRepository } from './modules/auth/auth.repository';
import { describeMailConfig, verifyMailTransport } from './modules/otp/mail.service';

async function main() {
  try {
    await checkDbConnection();
    // eslint-disable-next-line no-console
    console.log('Database connection established.');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to connect to database:', err);
    process.exit(1);
  }

  // Tell the developer at boot whether verification emails can actually be sent.
  if (env.OTP_REQUIRED) {
    if (env.SMTP_HOST) {
      const mail = await verifyMailTransport();
      // eslint-disable-next-line no-console
      console[mail.ok ? 'log' : 'error'](mail.ok ? `SMTP ready: ${mail.detail}` : `SMTP check FAILED (login codes will not be delivered): ${mail.detail}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`SMTP: ${describeMailConfig()}`);
    }
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`SleeknShine API listening on port ${env.PORT} [${env.NODE_ENV}]`);
  });

  // Housekeeping: purge long-expired / revoked refresh tokens once an hour.
  const cleanup = setInterval(() => {
    authRepository.deleteExpiredRefreshTokens().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Refresh token cleanup failed:', err);
    });
  }, 60 * 60 * 1000);
  cleanup.unref();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`${signal} received, shutting down gracefully...`);
    clearInterval(cleanup);
    server.close(async () => {
      await pool.end().catch(() => undefined);
      process.exit(0);
    });
    // Hard stop if connections refuse to drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    console.error('Unhandled promise rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('Uncaught exception:', err);
    shutdown('uncaughtException');
  });
}

main();
