import { Request, Response } from 'express';
import { sendSuccess } from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { usersService } from './users.service';

export const usersController = {
  getMe: asyncHandler(async (req: Request, res: Response) => {
    const user = await usersService.getMe(req.user!.id);
    sendSuccess(res, { user });
  }),

  updateMe: asyncHandler(async (req: Request, res: Response) => {
    const user = await usersService.updateMe(req.user!.id, req.body);
    sendSuccess(res, { user }, 'Profile updated successfully');
  }),

  listAddresses: asyncHandler(async (req: Request, res: Response) => {
    const addresses = await usersService.listAddresses(req.user!.id);
    sendSuccess(res, { addresses });
  }),

  createAddress: asyncHandler(async (req: Request, res: Response) => {
    const address = await usersService.createAddress(req.user!.id, req.body);
    sendSuccess(res, { address }, 'Address added successfully', 201);
  }),

  updateAddress: asyncHandler(async (req: Request, res: Response) => {
    const address = await usersService.updateAddress(
      req.user!.id,
      req.params.id,
      req.body
    );
    sendSuccess(res, { address }, 'Address updated successfully');
  }),

  deleteAddress: asyncHandler(async (req: Request, res: Response) => {
    await usersService.deleteAddress(req.user!.id, req.params.id);
    sendSuccess(res, {}, 'Address deleted successfully');
  }),
};
