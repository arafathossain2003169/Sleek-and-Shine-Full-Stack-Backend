import { Request, Response, Router } from 'express';
import { uploadBufferToCloudinary } from '../../config/cloudinary';
import { sendSuccess } from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { BadRequestError } from '../../utils/errors';
import { requireAuth } from '../../middlewares/auth.middleware';
import { CATALOG_WRITE_ROLES, requireRole } from '../../middlewares/role.middleware';
import { upload } from '../../middlewares/upload.middleware';
import { uploadRateLimiter } from '../../middlewares/rateLimit.middleware';

const ALLOWED_FOLDERS = new Set([
  'products', 'variants', 'categories', 'brands', 'homepage', 'misc',
]);

export const mediaController = {
  upload: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw new BadRequestError('No file provided');
    const folder = ALLOWED_FOLDERS.has(req.body.folder) ? req.body.folder : 'misc';
    const result = await uploadBufferToCloudinary(req.file.buffer, folder);
    sendSuccess(
      res,
      { publicId: result.public_id, url: result.secure_url, width: result.width, height: result.height },
      'File uploaded successfully',
      201
    );
  }),
};

const router = Router();
router.post(
  '/upload',
  requireAuth,
  requireRole(...CATALOG_WRITE_ROLES),
  uploadRateLimiter,
  upload.single('file'),
  mediaController.upload
);

export default router;
