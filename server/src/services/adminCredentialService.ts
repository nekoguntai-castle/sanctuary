import { userRepository } from '../repositories';
import { verifyPassword } from '../utils/password';

export async function verifyAdminPassword(userId: string, password: string): Promise<boolean> {
  const user = await userRepository.findByIdWithSelect(userId, { password: true });
  if (!user) {
    return false;
  }

  return verifyPassword(password, user.password);
}
