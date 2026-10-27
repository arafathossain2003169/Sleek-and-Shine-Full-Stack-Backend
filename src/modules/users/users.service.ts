import { BadRequestError, NotFoundError } from '../../utils/errors';
import { authRepository } from '../auth/auth.repository';
import { sanitizeUser } from '../auth/auth.service';
import { usersRepository } from './users.repository';

export const usersService = {
  async getMe(userId: string) {
    const user = await authRepository.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    return sanitizeUser(user);
  },

  async updateMe(userId: string, input: { name?: string; phone?: string | null }) {
    await usersRepository.updateProfile(userId, input);
    return this.getMe(userId);
  },

  async listAddresses(userId: string) {
    return usersRepository.listAddresses(userId);
  },

  async createAddress(userId: string, input: Parameters<typeof usersRepository.createAddress>[1]) {
    if ((await usersRepository.countAddresses(userId)) >= usersRepository.MAX_ADDRESSES) {
      throw new BadRequestError(`You can save at most ${usersRepository.MAX_ADDRESSES} addresses`);
    }
    return usersRepository.createAddress(userId, input);
  },

  async updateAddress(userId: string, addressId: string, input: Parameters<typeof usersRepository.updateAddress>[2]) {
    const updated = await usersRepository.updateAddress(userId, addressId, input);
    if (!updated) throw new NotFoundError('Address not found');
    return updated;
  },

  async deleteAddress(userId: string, addressId: string) {
    const deleted = await usersRepository.deleteAddress(userId, addressId);
    if (!deleted) throw new NotFoundError('Address not found');
    return deleted;
  },
};
