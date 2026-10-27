import { Request, Response } from 'express';
import { sendSuccess } from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { productsService } from './products.service';

export const productsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { products, meta } = await productsService.listPublic(req.query as never);
    sendSuccess(res, { products }, 'Products fetched', 200, meta);
  }),

  getBySlug: asyncHandler(async (req: Request, res: Response) => {
    const product = await productsService.getBySlug(req.params.slug);
    sendSuccess(res, { product });
  }),

  related: asyncHandler(async (req: Request, res: Response) => {
    const products = await productsService.related(req.params.slug);
    sendSuccess(res, { products });
  }),
};
