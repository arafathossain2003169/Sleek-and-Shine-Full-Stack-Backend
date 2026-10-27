import { NotFoundError } from '../../utils/errors';
import { contentRepository } from './content.repository';
import { productsService } from '../products/products.service';
import { categoriesService } from '../categories/categories.service';

export const contentService = {
  async getHomepage() {
    const [sections, newArrivals, offers, featured, categoryTree] = await Promise.all([
      contentRepository.listActiveSections(),
      productsService.listPublic({ isNewArrival: true, limit: '8' }),
      productsService.listPublic({ isOffer: true, limit: '8' }),
      productsService.listPublic({ isFeatured: true, limit: '8' }),
      categoriesService.tree(),
    ]);

    return {
      sections,
      newArrivals: newArrivals.products,
      offers: offers.products,
      featured: featured.products,
      categories: categoryTree,
    };
  },

  async adminList() {
    return contentRepository.listAllSections();
  },

  async adminCreate(input: Record<string, unknown>) {
    return contentRepository.create(input);
  },

  async adminUpdate(id: string, input: Record<string, unknown>) {
    const existing = await contentRepository.findById(id);
    if (!existing) throw new NotFoundError('Homepage section not found');
    const after = await contentRepository.update(id, input);
    return { before: existing, after };
  },

  async adminDelete(id: string) {
    const existing = await contentRepository.findById(id);
    if (!existing) throw new NotFoundError('Homepage section not found');
    await contentRepository.delete(id);
    return existing;
  },
};
