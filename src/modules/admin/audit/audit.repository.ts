import { query } from '../../../config/db';

export interface AuditLogInput {
  adminId: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
}

export const auditRepository = {
  async record(input: AuditLogInput): Promise<void> {
    await query(
      `INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, old_value, new_value, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.adminId,
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.oldValue !== undefined ? JSON.stringify(input.oldValue) : null,
        input.newValue !== undefined ? JSON.stringify(input.newValue) : null,
        input.ipAddress ?? null,
      ]
    );
  },

  async list(params: { limit: number; offset: number; entityType?: string; action?: string; adminId?: string; from?: string; to?: string }) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.entityType) {
      values.push(params.entityType);
      clauses.push(`al.entity_type = $${values.length}`);
    }
    if (params.action) {
      values.push(params.action);
      clauses.push(`al.action = $${values.length}`);
    }
    if (params.adminId) {
      values.push(params.adminId);
      clauses.push(`al.admin_id = $${values.length}`);
    }
    if (params.from) {
      values.push(params.from);
      clauses.push(`al.created_at >= $${values.length}`);
    }
    if (params.to) {
      values.push(params.to);
      clauses.push(`al.created_at <= $${values.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_logs al ${where}`,
      values
    );

    values.push(params.limit, params.offset);
    const dataResult = await query(
      `SELECT al.*, u.name AS admin_name, u.email AS admin_email
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.admin_id
       ${where}
       ORDER BY al.created_at DESC, al.id ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return { rows: dataResult.rows, total: parseInt(countResult.rows[0].count, 10) };
  },
};

export function recordAuditSafely(input: AuditLogInput): void {
  // Fire-and-forget so audit logging never blocks the main request path,
  // but log failures for operational visibility.
  auditRepository.record(input).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to write audit log:', err);
  });
}
