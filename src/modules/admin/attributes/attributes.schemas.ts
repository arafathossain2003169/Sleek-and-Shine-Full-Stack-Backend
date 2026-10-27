import { z } from 'zod';
import { optionalSlug } from '../../../utils/validators';

export const attributeTypeEnum = z.enum([
  'text', 'number', 'select', 'multiselect', 'boolean', 'richtext', 'date', 'color', 'measurement',
]);

export const createAttributeSchema = z.object({
  name: z.string().trim().min(1).max(150),
  slug: optionalSlug(180),
  type: attributeTypeEnum,
  predefinedValues: z.array(z.string().trim().min(1).max(200)).max(200).optional().default([]),
  isRequired: z.boolean().optional().default(false),
  isFilterable: z.boolean().optional().default(false),
  isVisible: z.boolean().optional().default(true),
  appliesTo: z.enum(['product', 'variant', 'both']).optional().default('product'),
  sortOrder: z.number().int().min(0).max(100000).optional().default(0),
});

export const updateAttributeSchema = createAttributeSchema.omit({ slug: true }).partial();

export const idParamSchema = z.object({ id: z.string().uuid() });
