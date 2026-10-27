import { Request, Response } from 'express';
import { sendSuccess } from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { categoriesService } from './categories.service';

export const categoriesController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    const categories = await categoriesService.listPublic();
    sendSuccess(res, { categories });
  }),

  tree: asyncHandler(async (_req: Request, res: Response) => {
    const tree = await categoriesService.tree();
    sendSuccess(res, { categories: tree });
  }),

  productsInCategory: asyncHandler(async (req: Request, res: Response) => {
    const { category, products, meta } = await categoriesService.productsInCategory(
      req.params.slug,
      req.query as Record<string, unknown>
    );
    sendSuccess(res, { category, products }, 'Products fetched', 200, meta);
  }),
};
