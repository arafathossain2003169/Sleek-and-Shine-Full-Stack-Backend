import { PoolClient } from 'pg';
import { query, withTransaction } from '../../config/db';
import { updateRow } from '../../utils/sql';

const MAX_ADDRESSES = 20;

interface AddressInput {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  zone?: string | null;
  postalCode?: string | null;
  country: string;
  isDefault: boolean;
}

const ADDRESS_COLUMNS = {
  fullName: 'full_name',
  phone: 'phone',
  addressLine1: 'address_line_1',
  addressLine2: 'address_line_2',
  city: 'city',
  zone: 'zone',
  postalCode: 'postal_code',
  country: 'country',
  isDefault: 'is_default',
};

async function unsetDefaults(client: PoolClient, userId: string, exceptId?: string) {
  await client.query(
    'UPDATE addresses SET is_default = FALSE WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2)',
    [userId, exceptId ?? null]
  );
}

export const usersRepository = {
  async updateProfile(userId: string, input: { name?: string; phone?: string | null }) {
    const row = await updateRow('users', userId, { name: 'name', phone: 'phone' }, input);
    if (!row) return null;
    const { password_hash: _omit, ...safe } = row as Record<string, unknown>;
    return safe;
  },

  async listAddresses(userId: string) {
    const result = await query(
      'SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
      [userId]
    );
    return result.rows;
  },

  async findAddress(userId: string, addressId: string) {
    const result = await query('SELECT * FROM addresses WHERE id = $1 AND user_id = $2', [
      addressId,
      userId,
    ]);
    return result.rows[0] ?? null;
  },

  async countAddresses(userId: string): Promise<number> {
    const r = await query<{ c: string }>('SELECT COUNT(*)::text AS c FROM addresses WHERE user_id = $1', [userId]);
    return parseInt(r.rows[0].c, 10);
  },

  MAX_ADDRESSES,

  /** The first address a user adds automatically becomes the default. */
  async createAddress(userId: string, input: AddressInput) {
    return withTransaction(async (client) => {
      const existing = await client.query('SELECT COUNT(*)::int AS c FROM addresses WHERE user_id = $1', [userId]);
      const makeDefault = input.isDefault || existing.rows[0].c === 0;
      if (makeDefault) await unsetDefaults(client, userId);
      const result = await client.query(
        `INSERT INTO addresses
          (user_id, full_name, phone, address_line_1, address_line_2, city, zone, postal_code, country, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          userId, input.fullName, input.phone, input.addressLine1, input.addressLine2 ?? null,
          input.city, input.zone ?? null, input.postalCode ?? null, input.country, makeDefault,
        ]
      );
      return result.rows[0];
    });
  },

  async updateAddress(userId: string, addressId: string, input: Partial<AddressInput>) {
    return withTransaction(async (client) => {
      const owned = await client.query('SELECT id, is_default FROM addresses WHERE id = $1 AND user_id = $2 FOR UPDATE', [addressId, userId]);
      if (!owned.rowCount) return null;
      if (input.isDefault) await unsetDefaults(client, userId, addressId);
      // Never leave a user without a default by un-defaulting the only default.
      const patch: Record<string, unknown> = { ...input };
      if (input.isDefault === false && owned.rows[0].is_default) delete patch.isDefault;
      return (await updateRow('addresses', addressId, ADDRESS_COLUMNS, patch, client)) as Record<string, unknown>;
    });
  },

  async deleteAddress(userId: string, addressId: string) {
    return withTransaction(async (client) => {
      const deleted = await client.query(
        'DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING id, is_default',
        [addressId, userId]
      );
      const row = deleted.rows[0];
      if (!row) return null;
      if (row.is_default) {
        // Promote the most recent remaining address.
        await client.query(
          `UPDATE addresses SET is_default = TRUE
           WHERE id = (SELECT id FROM addresses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)`,
          [userId]
        );
      }
      return row;
    });
  },
};
