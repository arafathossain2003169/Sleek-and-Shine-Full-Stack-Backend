import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

// Valid bcrypt hash of a random value; used to equalise login timing for unknown emails.
export const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', SALT_ROUNDS);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
