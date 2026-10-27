import { ConflictError, NotFoundError } from '../../../utils/errors';
import { slugify } from '../../../utils/slug';
import { attributeDefinitionsRepository } from './attributes.repository';
import { invalidateAttributeCache } from './attributes.validation';

export const attributesService = {
  async list() {
    return attributeDefinitionsRepository.list();
  },

  async create(input: {
    name: string;
    slug?: string;
    type: string;
    predefinedValues: unknown[];
    isRequired: boolean;
    isFilterable: boolean;
    isVisible: boolean;
    appliesTo: string;
    sortOrder: number;
  }) {
    const slug = input.slug || slugify(input.name);
    const existing = await attributeDefinitionsRepository.findBySlug(slug);
    if (existing) throw new ConflictError('An attribute with this slug already exists');
    const created = await attributeDefinitionsRepository.create({ ...input, slug });
    invalidateAttributeCache();
    return created;
  },

  async update(id: string, input: Record<string, unknown>) {
    const existing = await attributeDefinitionsRepository.findById(id);
    if (!existing) throw new NotFoundError('Attribute definition not found');
    if (input.type && input.type !== existing.type && (await attributeDefinitionsRepository.isInUse(existing.slug))) {
      throw new ConflictError(
        'This attribute already has values on products. Changing its type would corrupt them; create a new attribute instead.'
      );
    }
    const updated = await attributeDefinitionsRepository.update(id, input);
    invalidateAttributeCache();
    return { before: existing, after: updated };
  },

  async delete(id: string) {
    const existing = await attributeDefinitionsRepository.findById(id);
    if (!existing) throw new NotFoundError('Attribute definition not found');
    await attributeDefinitionsRepository.stripFromProducts(existing.slug);
    await attributeDefinitionsRepository.delete(id);
    invalidateAttributeCache();
    return existing;
  },
};
