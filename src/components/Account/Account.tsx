import { useUser } from '../../contexts/UserContext';
import { AccountView } from './Account/AccountView';
import { usePasswordChangeController } from './Account/usePasswordChangeController';
import { useTwoFactorController } from './Account/useTwoFactorController';

export const Account = () => {
  const { user } = useUser();
  const password = usePasswordChangeController();
  const twoFactor = useTwoFactorController(user?.twoFactorEnabled || false);

  return (
    <AccountView
      user={user}
      password={password}
      twoFactor={twoFactor}
    />
  );
};
