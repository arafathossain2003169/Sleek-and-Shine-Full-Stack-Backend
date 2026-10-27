import { Request, Response } from 'express';
import { sendSuccess } from '../../../utils/apiResponse';
import { asyncHandler } from '../../../utils/asyncHandler';
import { recordAuditSafely } from '../audit/audit.repository';
import { attributesService } from './attributes.service';

export const attributesController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    const attributes = await attributesService.list();
    sendSuccess(res, { attributes });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const attribute = await attributesService.create(req.body);
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'create',
      entityType: 'attribute_definition',
      entityId: attribute.id,
      newValue: attribute,
      ipAddress: req.ip,
    });
    sendSuccess(res, { attribute }, 'Attribute created successfully', 201);
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { before, after: attribute } = await attributesService.update(req.params.id, req.body);
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'update',
      entityType: 'attribute_definition',
      entityId: req.params.id,
      oldValue: before,
      newValue: attribute,
      ipAddress: req.ip,
    });
    sendSuccess(res, { attribute }, 'Attribute updated successfully');
  }),

  delete: asyncHandler(async (req: Request, res: Response) => {
    const deleted = await attributesService.delete(req.params.id);
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'delete',
      entityType: 'attribute_definition',
      entityId: req.params.id,
      oldValue: deleted,
      ipAddress: req.ip,
    });
    sendSuccess(res, {}, 'Attribute deleted successfully');
  }),
};
