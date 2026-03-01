/**
 * Docker Container Management Types
 *
 * Shared type definitions for Docker container management.
 */

export interface ContainerInfo {
  Id: string;
  Names: string[];
  State: string;
  Status: string;
}

export interface ContainerInspect {
  State: {
    Status: string;
    Running: boolean;
    Paused: boolean;
    Restarting: boolean;
    Dead: boolean;
    StartedAt: string;
  };
}

export interface ContainerStatus {
  exists: boolean;
  running: boolean;
  status: string;
  containerId?: string;
}

export interface ContainerActionResult {
  success: boolean;
  message: string;
}
