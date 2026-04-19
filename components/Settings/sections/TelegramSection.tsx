import React from 'react';
import { TelegramSectionPanel } from './TelegramSectionPanel';
import { useTelegramSettings } from './useTelegramSettings';

const TelegramSettings: React.FC = () => {
  const settings = useTelegramSettings();
  return <TelegramSectionPanel settings={settings} />;
};

export { TelegramSettings };
