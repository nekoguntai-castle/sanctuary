import { LabelManagerView } from './LabelManager/LabelManagerView';
import { useLabelManagerController } from './LabelManager/useLabelManagerController';
import type { LabelManagerProps } from './LabelManager/types';

export const LabelManager = (props: LabelManagerProps) => {
  const controller = useLabelManagerController(props);
  return <LabelManagerView controller={controller} />;
};

export default LabelManager;
