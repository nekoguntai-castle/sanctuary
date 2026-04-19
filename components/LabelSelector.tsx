import { DropdownLabelSelector } from './LabelSelector/DropdownLabelSelector';
import { InlineLabelSelector } from './LabelSelector/InlineLabelSelector';
import { useLabelSelectorController } from './LabelSelector/useLabelSelectorController';
import type { LabelSelectorProps } from './LabelSelector/types';

export { LabelBadges } from './LabelSelector/LabelBadges';
export type { LabelBadgesProps, LabelSelectorProps } from './LabelSelector/types';

export function LabelSelector({
  className = '',
  disabled = false,
  mode = 'dropdown',
  onChange,
  selectedLabels,
  showCreateOption = true,
  walletId,
}: LabelSelectorProps) {
  const controller = useLabelSelectorController({ onChange, selectedLabels, walletId });

  if (mode === 'inline') {
    return (
      <InlineLabelSelector
        availableLabels={controller.availableLabels}
        className={className}
        disabled={disabled}
        onOpenDropdown={() => controller.setIsOpen(true)}
        onRemoveLabel={controller.handleRemoveLabel}
        onToggleLabel={controller.handleToggleLabel}
        selectedLabels={selectedLabels}
      />
    );
  }

  return (
    <DropdownLabelSelector
      className={className}
      controller={controller}
      disabled={disabled}
      selectedLabels={selectedLabels}
      showCreateOption={showCreateOption}
    />
  );
}

export default LabelSelector;
