import { deviceRepository } from '../repositories';

export interface DeviceCatalogFilters {
  manufacturer?: string;
  airGapped?: boolean;
  connectivity?: string;
  discontinued?: boolean;
}

export function listHardwareDeviceModels(filters: DeviceCatalogFilters) {
  return deviceRepository.findHardwareModels(filters);
}

export function getHardwareDeviceModel(slug: string) {
  return deviceRepository.findHardwareModel(slug);
}

export function listHardwareDeviceManufacturers() {
  return deviceRepository.findManufacturers();
}
