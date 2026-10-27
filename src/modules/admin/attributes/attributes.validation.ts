import { BadRequestError } from '../../../utils/errors';
import { AttributeDefinitionRow, attributeDefinitionsRepository } from './attributes.repository';

let cache: { at: number; rows: AttributeDefinitionRow[] } | null = null;
const TTL_MS = 30_000;

/** Attribute definitions change rarely but are read on every storefront request. */
export async function getAttributeDefinitions(): Promise<AttributeDefinitionRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = await attributeDefinitionsRepository.list();
  cache = { at: Date.now(), rows };
  return rows;
}

export function invalidateAttributeCache(): void {
  cache = null;
}

type Scope = 'product' | 'variant';

function checkValue(def: AttributeDefinitionRow, value: unknown): string | null {
  const predefined = (def.predefined_values ?? []) as string[];
  switch (def.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a number';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'select':
      if (typeof value !== 'string') return 'must be a single value';
      return predefined.length && !predefined.includes(value) ? `must be one of: ${predefined.join(', ')}` : null;
    case 'multiselect':
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return 'must be a list of values';
      return predefined.length && value.some((v) => !predefined.includes(v as string))
        ? `values must be among: ${predefined.join(', ')}`
        : null;
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? null : 'must be a valid date';
    default: // text, richtext, color, measurement
      return typeof value === 'string' && value.length <= 5000 ? null : 'must be text';
  }
}

/**
 * Validates attribute values against the admin-defined schema: known keys, correct types,
 * allowed options, and (when publishing) all required attributes present.
 */
export async function validateAttributes(
  attributes: Record<string, unknown> | undefined,
  opts: { scope: Scope; requireRequired: boolean }
): Promise<void> {
  const defs = (await getAttributeDefinitions()).filter(
    (d) => d.applies_to === 'both' || d.applies_to === opts.scope
  );
  const bySlug = new Map(defs.map((d) => [d.slug, d]));
  const values = attributes ?? {};
  const problems: { path: string; message: string }[] = [];

  for (const [key, value] of Object.entries(values)) {
    const def = bySlug.get(key);
    if (!def) {
      problems.push({ path: `attributes.${key}`, message: 'Unknown attribute' });
      continue;
    }
    const issue = checkValue(def, value);
    if (issue) problems.push({ path: `attributes.${key}`, message: `${def.name} ${issue}` });
  }

  if (opts.requireRequired) {
    for (const def of defs) {
      const v = values[def.slug];
      const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
      if (def.is_required && empty) {
        problems.push({ path: `attributes.${def.slug}`, message: `${def.name} is required` });
      }
    }
  }

  if (problems.length) throw new BadRequestError('Invalid attributes', problems);
}
