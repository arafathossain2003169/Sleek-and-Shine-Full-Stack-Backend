/**
 * Makes an account a super admin (the owner account).
 *   npm run admin:grant -- you@example.com            # the account must already exist (register it on the site first)
 *   npm run admin:grant -- you@example.com "Passw0rd1" # creates the account if it does not exist
 * Afterwards, admins can promote other accounts from the admin panel (Admin -> Staff).
 */
import { pool, query } from '../config/db';
import { authRepository } from '../modules/auth/auth.repository';
import { hashPassword } from '../utils/password';

(async () => {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  const password = process.argv[3];
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    console.error('Usage: npm run admin:grant -- <email> [password-for-a-new-account]');
    process.exit(1);
  }
  const existing = await authRepository.findByEmail(email);
  if (existing) {
    await query(`UPDATE users SET role = 'super_admin', status = 'active', email_verified = TRUE, updated_at = now() WHERE id = $1`, [existing.id]);
    console.log(`${email} is now a super admin. Log in at /login (a code will be e-mailed to this address).`);
  } else if (password) {
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      console.error('Password needs at least 8 characters with a letter and a number.');
      process.exit(1);
    }
    const user = await authRepository.createUser({ name: 'Admin', email, passwordHash: await hashPassword(password), role: 'super_admin' });
    await authRepository.markEmailVerified(user.id);
    console.log(`Created super admin ${email}. Log in at /login (a code will be e-mailed to this address).`);
  } else {
    console.error(`No account exists for ${email}. Register it on the site first, then run this again,\nor pass a password to create it:  npm run admin:grant -- ${email} "YourPassw0rd"`);
    process.exit(1);
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
