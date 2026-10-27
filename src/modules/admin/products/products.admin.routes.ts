import { Router } from 'express';
import { upload } from '../../../middlewares/upload.middleware';
import { uploadRateLimiter } from '../../../middlewares/rateLimit.middleware';
import { validate } from '../../../middlewares/validate.middleware';
import {
  adminListProductsQuerySchema,
  createProductSchema,
  createVariantSchema,
  imageIdParamSchema,
  productIdParamSchema,
  updateImageSchema,
  updateProductSchema,
  updateProductStatusSchema,
  updateVariantSchema,
  variantIdParamSchema,
} from '../../products/products.schemas';
import { adminProductsController } from './products.admin.controller';

const router = Router();

router.get('/', validate({ query: adminListProductsQuerySchema }), adminProductsController.list);
router.post('/', validate({ body: createProductSchema }), adminProductsController.create);
router.get('/:id', validate({ params: productIdParamSchema }), adminProductsController.getById);
router.patch(
  '/:id',
  validate({ params: productIdParamSchema, body: updateProductSchema }),
  adminProductsController.update
);
router.delete('/:id', validate({ params: productIdParamSchema }), adminProductsController.delete);
router.patch(
  '/:id/status',
  validate({ params: productIdParamSchema, body: updateProductStatusSchema }),
  adminProductsController.updateStatus
);
router.post(
  '/:id/duplicate',
  validate({ params: productIdParamSchema }),
  adminProductsController.duplicate
);

router.post(
  '/:id/images',
  uploadRateLimiter,
  validate({ params: productIdParamSchema }),
  upload.single('image'),
  adminProductsController.addImage
);
router.patch(
  '/:id/images/:imageId',
  validate({ params: imageIdParamSchema, body: updateImageSchema }),
  adminProductsController.updateImage
);
router.delete(
  '/:id/images/:imageId',
  validate({ params: imageIdParamSchema }),
  adminProductsController.deleteImage
);

router.post(
  '/:id/variants',
  validate({ params: productIdParamSchema, body: createVariantSchema }),
  adminProductsController.createVariant
);
router.patch(
  '/:id/variants/:variantId',
  validate({ params: variantIdParamSchema, body: updateVariantSchema }),
  adminProductsController.updateVariant
);
router.delete(
  '/:id/variants/:variantId',
  validate({ params: variantIdParamSchema }),
  adminProductsController.deleteVariant
);

export default router;
