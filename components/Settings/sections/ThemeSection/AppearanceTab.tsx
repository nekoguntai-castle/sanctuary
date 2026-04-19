import { AppearanceTabView } from './AppearanceTab/AppearanceTabView';
import { useAppearanceTabController } from './AppearanceTab/useAppearanceTabController';

const AppearanceTab = () => {
  const controller = useAppearanceTabController();
  return <AppearanceTabView controller={controller} />;
};

export { AppearanceTab };
