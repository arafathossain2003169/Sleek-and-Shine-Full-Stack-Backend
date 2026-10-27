import { PoolClient } from 'pg';
import { query as poolQuery } from '../config/db';

/** Escapes LIKE/ILIKE wildcards so user input is matched literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface ColumnSpec {
  column: string;
  json?: boolean;
}

type Runner = Pick<PoolClient, 'query'> | null;

/**
 * Builds a partial UPDATE from the keys that are actually present in `input`.
 * `undefined` = "leave untouched", `null` = "set NULL" (so optional fields can be cleared,
 * which COALESCE-style updates cannot do). Table/column names come from code constants only.
 */
export async function updateRow(
  table: string,
  id: string,
  spec: Record<string, ColumnSpec | string>,
  input: Record<string, unknown>,
  runner: Runner = null,
  idColumn = 'id'
): Promise<Record<string, unknown> | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  for (const [key, def] of Object.entries(spec)) {
    const value = input[key];
    if (value === undefined) continue;
    const column = typeof def === 'string' ? def : def.column;
    const isJson = typeof def !== 'string' && def.json;
    values.push(isJson && value !== null ? JSON.stringify(value) : value);
    sets.push(`${column} = $${values.length}${isJson ? '::jsonb' : ''}`);
  }
  sets.push('updated_at = now()');
  const text = `UPDATE ${table} SET ${sets.join(', ')} WHERE ${idColumn} = $1 RETURNING *`;
  const result = runner ? await runner.query(text, values) : await poolQuery(text, values);
  return (result.rows[0] as Record<string, unknown>) ?? null;
}
