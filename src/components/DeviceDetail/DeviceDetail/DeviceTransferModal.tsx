import type { Device } from '../../../types';
import { TransferOwnershipModal } from '../../TransferOwnershipModal';

type DeviceTransferModalProps = {
  device: Device;
  onClose: () => void;
};

export function DeviceTransferModal({ device, onClose }: DeviceTransferModalProps) {
  return (
    <TransferOwnershipModal
      resourceType="device"
      resourceId={device.id}
      resourceName={device.label}
      onClose={onClose}
      onTransferInitiated={onClose}
    />
  );
}
