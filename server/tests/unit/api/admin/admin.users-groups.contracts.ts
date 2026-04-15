import { registerAdminGroupTests } from './admin.groups.contracts';
import { registerAdminUserTests } from './admin.users.contracts';

export function registerAdminUsersGroupsTests(): void {
  registerAdminUserTests();
  registerAdminGroupTests();
}
