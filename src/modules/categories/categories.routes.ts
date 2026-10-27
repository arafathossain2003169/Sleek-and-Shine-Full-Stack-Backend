import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware';
import { categoriesController } from './categories.controller';
import { listProductsQuerySchema, slugParamSchema } from './categories.schemas';

const router = Router();

router.get('/', categoriesController.list);
router.get('/tree', categoriesController.tree);
router.get(
  '/:slug/products',
  validate({ params: slugParamSchema, query: listProductsQuerySchema }),
  categoriesController.productsInCategory
);

export default router;
