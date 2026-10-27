import { Request, Response, Router } from 'express';
import { sendSuccess } from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middlewares/validate.middleware';
import { brandsService } from './brands.service';
import { listQuerySchema, slugParamSchema } from './brands.schemas';

export const brandsController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    const brands = await brandsService.listPublic();
    sendSuccess(res, { brands });
  }),

  productsForBrand: asyncHandler(async (req: Request, res: Response) => {
    const { brand, products, meta } = await brandsService.productsForBrand(
      req.params.slug,
      req.query as Record<string, unknown>
    );
    sendSuccess(res, { brand, products }, 'Products fetched', 200, meta);
  }),
};

const router = Router();
router.get('/', brandsController.list);
router.get(
  '/:slug/products',
  validate({ params: slugParamSchema, query: listQuerySchema }),
  brandsController.productsForBrand
);

export default router;
