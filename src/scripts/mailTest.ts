/**
 * Sends a real test e-mail through your SMTP settings and prints exactly what happened.
 *   npm run mail:test -- you@example.com
 */
import { describeMailConfig, describeMailError, otpEmail, sendMail, verifyMailTransport } from '../modules/otp/mail.service';
import { env } from '../config/env';

(async () => {
  const to = process.argv[2];
  console.log(`SMTP config : ${describeMailConfig()}`);
  if (!env.SMTP_HOST) {
    console.error('\nSMTP_HOST is empty in backend/.env, so nothing can be sent. See backend/.env.example (Gmail example).');
    process.exit(1);
  }
  const check = await verifyMailTransport();
  console.log(`Connection  : ${check.ok ? 'OK (connected and authenticated)' : `FAILED - ${check.detail}`}`);
  if (!check.ok) process.exit(1);
  if (!to) {
    console.log('\nConnection works. Pass an address to send a real message:  npm run mail:test -- you@example.com');
    return;
  }
  try {
    await sendMail({ to, ...otpEmail('123456', 'login', env.OTP_TTL_MINUTES) });
    console.log(`Send        : OK. Check the inbox (and spam folder) of ${to} for a "123456 is your SleeknShine verification code" email.`);
  } catch (err) {
    console.error(`Send        : FAILED - ${describeMailError(err)}`);
    process.exit(1);
  }
})();
