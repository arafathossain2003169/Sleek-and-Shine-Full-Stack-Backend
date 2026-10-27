import { z } from 'zod';
import { phoneSchema } from '../auth/auth.schemas';

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  // null clears the phone number
  phone: phoneSchema.nullable().optional(),
});

export const addressSchema = z.object({
  fullName: z.string().trim().min(2).max(150),
  phone: z.string().trim().min(5).max(30),
  addressLine1: z.string().trim().min(3).max(255),
  addressLine2: z.string().trim().max(255).nullable().optional(),
  city: z.string().trim().min(1).max(100),
  zone: z.string().trim().max(100).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  country: z.string().trim().min(1).max(100),
  isDefault: z.boolean().optional().default(false),
});

export const updateAddressSchema = addressSchema.partial().extend({ isDefault: z.boolean().optional() });

export const idParamSchema = z.object({ id: z.string().uuid('Invalid id') });
