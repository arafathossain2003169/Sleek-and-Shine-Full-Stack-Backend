import { Request, Response, Router } from 'express';
import { sendSuccess } from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { contentService } from './content.service';

export const contentController = {
  homepage: asyncHandler(async (_req: Request, res: Response) => {
    const homepage = await contentService.getHomepage();
    sendSuccess(res, homepage, 'Homepage content fetched');
  }),
};

const router = Router();
router.get('/homepage', contentController.homepage);

export default router;
