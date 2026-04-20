import { WalletTelegramSettingsPage } from './WalletTelegramSettings/WalletTelegramSettingsPage';
import { useWalletTelegramSettingsController } from './WalletTelegramSettings/useWalletTelegramSettingsController';

interface Props {
  walletId: string;
}

export function WalletTelegramSettings({ walletId }: Props) {
  const controller = useWalletTelegramSettingsController(walletId);

  return <WalletTelegramSettingsPage controller={controller} />;
}
