import { query } from '../../config/db';
import { UserRole } from '../../utils/tokens';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  phone: string | null;
  role: UserRole;
  email_verified: boolean;
  status: 'active' | 'blocked' | 'deleted';
  created_at: Date;
  updated_at: Date;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export const authRepository = {
  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] ?? null;
  },

  async findById(id: string): Promise<UserRow | null> {
    const result = await query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  },

  async createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
    phone?: string;
    role?: UserRole;
  }): Promise<UserRow> {
    const result = await query<UserRow>(
      `INSERT INTO users (name, email, password_hash, phone, role)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'customer'))
       RETURNING *`,
      [input.name, input.email, input.passwordHash, input.phone ?? null, input.role ?? null]
    );
    return result.rows[0];
  },

  /** Re-registration of a never-verified customer account: the newest sign-up details win. */
  async resetUnverifiedCustomer(userId: string, input: { name: string; passwordHash: string; phone?: string }): Promise<void> {
    await query(
      `UPDATE users SET name = $2, password_hash = $3, phone = COALESCE($4, phone), updated_at = now()
       WHERE id = $1 AND role = 'customer' AND email_verified = FALSE`,
      [userId, input.name, input.passwordHash, input.phone ?? null]
    );
  },

  async markEmailVerified(userId: string): Promise<void> {
    await query('UPDATE users SET email_verified = TRUE, updated_at = now() WHERE id = $1', [userId]);
  },

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
      userId,
      passwordHash,
    ]);
  },

  /** The row id MUST equal the tokenId embedded in the JWT, otherwise lookups never match. */
  async storeRefreshToken(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.id, input.userId, input.tokenHash, input.expiresAt]
    );
  },

  async findRefreshTokenById(id: string): Promise<RefreshTokenRow | null> {
    const result = await query<RefreshTokenRow>('SELECT * FROM refresh_tokens WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  },

  /** Atomically revokes a token; returns false when it was already revoked (reuse / race). */
  async revokeRefreshToken(id: string): Promise<boolean> {
    const result = await query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    await query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    );
  },

  async deleteExpiredRefreshTokens(): Promise<number> {
    const result = await query(
      `DELETE FROM refresh_tokens
       WHERE expires_at < now() - interval '7 days'
          OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')`
    );
    return result.rowCount ?? 0;
  },
};
