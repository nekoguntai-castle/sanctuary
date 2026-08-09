import React from 'react';
import { useParams } from 'react-router-dom';
import { DeviceDetailContent } from './DeviceDetail/DeviceDetailContent';
import {
  DeviceDetailLoadingState,
  DeviceDetailNotFoundState,
} from './DeviceDetail/DeviceDetailStates';
import { useDeviceData } from './hooks/useDeviceData';

export const DeviceDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const data = useDeviceData(id);

  if (data.loading) return <DeviceDetailLoadingState />;
  if (data.device && data.device.id !== id) return <DeviceDetailLoadingState />;
  if (!data.device) return <DeviceDetailNotFoundState />;

  return (
    <DeviceDetailContent
      key={data.ownershipKey}
      id={id!}
      data={{ ...data, device: data.device }}
    />
  );
};
