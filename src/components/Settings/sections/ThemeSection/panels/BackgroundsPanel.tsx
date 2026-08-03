import { BackgroundsPanelView } from './BackgroundsPanel/BackgroundsPanelView';
import type { BackgroundsPanelProps } from './BackgroundsPanel/types';
import { useBackgroundsPanelController } from './BackgroundsPanel/useBackgroundsPanelController';

export const BackgroundsPanel = (props: BackgroundsPanelProps) => {
  const controller = useBackgroundsPanelController(props);

  return (
    <BackgroundsPanelView
      controller={controller}
      currentBg={props.currentBg}
      animatedBackgrounds={props.animatedBackgrounds}
      favoriteBackgrounds={props.favoriteBackgrounds}
      onSelectBackground={props.onSelectBackground}
      onToggleFavorite={props.onToggleFavorite}
      onUpdateSeasonBackground={props.onUpdateSeasonBackground}
    />
  );
};

export type { BackgroundInfo, BackgroundsPanelProps } from './BackgroundsPanel/types';
