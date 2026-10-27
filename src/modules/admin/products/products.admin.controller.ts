import { Request, Response } from 'express';
import { uploadBufferToCloudinary, deleteFromCloudinary } from '../../../config/cloudinary';
import { sendSuccess } from '../../../utils/apiResponse';
import { asyncHandler } from '../../../utils/asyncHandler';
import { BadRequestError } from '../../../utils/errors';
import { imageUploadMetaSchema } from '../../products/products.schemas';
import { recordAuditSafely } from '../audit/audit.repository';
import { productsService } from '../../products/products.service';

export const adminProductsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { products, meta } = await productsService.adminList(req.query as never);
    sendSuccess(res, { products }, 'Products fetched', 200, meta);
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const product = await productsService.adminGetById(req.params.id);
    sendSuccess(res, { product });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const product = await productsService.adminCreate(req.body);
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'create',
      entityType: 'product',
      entityId: product.id,
      newValue: product,
      ipAddress: req.ip,
    });
    sendSuccess(res, { product }, 'Product created successfully', 201);
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { before, after: product } = await productsService.adminUpdate(req.params.id, req.body);
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'update',
      entityType: 'product',
      entityId: req.params.id,
      oldValue: before,
      newValue: product,
      ipAddress: req.ip,
    });
    sendSuccess(res, { product }, 'Product updated successfully');
  }),

  updateStatus: asyncHandler(async (req: Request, res: Response) => {
    const product = await productsService.adminUpdateStatus(req.params.id, req.body.status);
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'update_status',
      entityType: 'product',
      entityId: req.params.id,
      newValue: { status: req.body.status },
      ipAddress: req.ip,
    });
    sendSuccess(res, { product }, 'Product status updated');
  }),

  delete: asyncHandler(async (req: Request, res: Response) => {
    const { product, publicIds } = await productsService.adminDelete(req.params.id);
    // Best-effort cleanup so deleted products don't leave orphaned files in Cloudinary.
    publicIds.forEach((id) => deleteFromCloudinary(id).catch(() => undefined));
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'delete',
      entityType: 'product',
      entityId: req.params.id,
      oldValue: product,
      ipAddress: req.ip,
    });
    sendSuccess(res, {}, 'Product deleted successfully');
  }),

  duplicate: asyncHandler(async (req: Request, res: Response) => {
    const product = await productsService.adminDuplicate(req.params.id);
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'duplicate',
      entityType: 'product',
      entityId: product.id,
      newValue: { sourceId: req.params.id },
      ipAddress: req.ip,
    });
    sendSuccess(res, { product }, 'Product duplicated successfully', 201);
  }),

  addImage: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw new BadRequestError('No image file provided');
    const meta = imageUploadMetaSchema.parse(req.body);
    // Validate the product (and variant) BEFORE uploading so failures don't leave orphan files.
    await productsService.ensureExists(req.params.id);
    const uploadResult = await uploadBufferToCloudinary(req.file.buffer, 'products');
    try {
      const image = await productsService.adminAddImage(
        req.params.id,
        { publicId: uploadResult.public_id, url: uploadResult.secure_url },
        meta
      );
      recordAuditSafely({
        adminId: req.user!.id,
        action: 'add_image',
        entityType: 'product',
        entityId: req.params.id,
        newValue: image,
        ipAddress: req.ip,
      });
      sendSuccess(res, { image }, 'Image uploaded successfully', 201);
    } catch (err) {
      deleteFromCloudinary(uploadResult.public_id).catch(() => undefined);
      throw err;
    }
  }),

  updateImage: asyncHandler(async (req: Request, res: Response) => {
    const image = await productsService.adminUpdateImage(
      req.params.id,
      req.params.imageId,
      req.body
    );
    sendSuccess(res, { image }, 'Image updated successfully');
  }),

  deleteImage: asyncHandler(async (req: Request, res: Response) => {
    const image = await productsService.adminDeleteImage(req.params.id, req.params.imageId);
    deleteFromCloudinary(image.cloudinary_public_id as string).catch(() => {
      /* best-effort cleanup */
    });
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'delete_image',
      entityType: 'product',
      entityId: req.params.id,
      oldValue: image,
      ipAddress: req.ip,
    });
    sendSuccess(res, {}, 'Image deleted successfully');
  }),

  createVariant: asyncHandler(async (req: Request, res: Response) => {
    const variant = await productsService.adminCreateVariant(req.params.id, req.body, req.user!.id);
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'create_variant',
      entityType: 'product',
      entityId: req.params.id,
      newValue: variant,
      ipAddress: req.ip,
    });
    sendSuccess(res, { variant }, 'Variant created successfully', 201);
  }),

  updateVariant: asyncHandler(async (req: Request, res: Response) => {
    const { before, after: variant } = await productsService.adminUpdateVariant(
      req.params.id,
      req.params.variantId,
      req.body
    );
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'update_variant',
      entityType: 'product',
      entityId: req.params.id,
      oldValue: before,
      newValue: variant,
      ipAddress: req.ip,
    });
    sendSuccess(res, { variant }, 'Variant updated successfully');
  }),

  deleteVariant: asyncHandler(async (req: Request, res: Response) => {
    const variant = await productsService.adminDeleteVariant(req.params.id, req.params.variantId);
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'delete_variant',
      entityType: 'product',
      entityId: req.params.id,
      oldValue: variant,
      ipAddress: req.ip,
    });
    sendSuccess(res, {}, 'Variant deleted successfully');
  }),
};
