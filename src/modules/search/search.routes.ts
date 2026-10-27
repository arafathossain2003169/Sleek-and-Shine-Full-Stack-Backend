import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middlewares/validate.middleware';
import { digitsString } from '../../utils/validators';
import { SORT_VALUES } from '../products/products.schemas';
import { productsService } from '../products/products.service';

const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Search must be at least 2 characters').max(100),
  page: digitsString.optional(),
  limit: digitsString.optional(),
  sort: z.enum(SORT_VALUES).optional(),
});

const router = Router();

// Uses the exact same query + DTO as /products so the storefront renders every list identically.
router.get(
  '/',
  validate({ query: searchQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { q, ...rest } = req.query as Record<string, string>;
    const { products, meta } = await productsService.listPublic({ ...rest, search: q });
    sendSuccess(res, { products, query: q }, 'Search results fetched', 200, meta);
  })
);

export default router;
