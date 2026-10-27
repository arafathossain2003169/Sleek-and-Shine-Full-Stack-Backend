import { Router } from 'express';
import { validate } from '../../../middlewares/validate.middleware';
import { attributesController } from './attributes.controller';
import { createAttributeSchema, idParamSchema, updateAttributeSchema } from './attributes.schemas';

const router = Router();

router.get('/', attributesController.list);
router.post('/', validate({ body: createAttributeSchema }), attributesController.create);
router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateAttributeSchema }),
  attributesController.update
);
router.delete('/:id', validate({ params: idParamSchema }), attributesController.delete);

export default router;
