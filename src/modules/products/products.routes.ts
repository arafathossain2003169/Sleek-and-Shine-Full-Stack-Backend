import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware';
import { productsController } from './products.controller';
import { listProductsQuerySchema, slugParamSchema } from './products.schemas';

const router = Router();

router.get('/', validate({ query: listProductsQuerySchema }), productsController.list);
router.get('/:slug', validate({ params: slugParamSchema }), productsController.getBySlug);
router.get('/:slug/related', validate({ params: slugParamSchema }), productsController.related);

export default router;
