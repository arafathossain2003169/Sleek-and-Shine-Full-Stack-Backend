import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { usersController } from './users.controller';
import { addressSchema, idParamSchema, updateAddressSchema, updateProfileSchema } from './users.schemas';

const router = Router();

router.use(requireAuth);

router.get('/me', usersController.getMe);
router.patch('/me', validate({ body: updateProfileSchema }), usersController.updateMe);

router.get('/me/addresses', usersController.listAddresses);
router.post(
  '/me/addresses',
  validate({ body: addressSchema }),
  usersController.createAddress
);
router.patch(
  '/me/addresses/:id',
  validate({ params: idParamSchema, body: updateAddressSchema }),
  usersController.updateAddress
);
router.delete(
  '/me/addresses/:id',
  validate({ params: idParamSchema }),
  usersController.deleteAddress
);

export default router;
