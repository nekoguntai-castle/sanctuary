import { useState } from 'react';
import type { NodeConfig as NodeConfigType } from '../../types';
import * as adminApi from '../../src/api/admin';
import { createLogger } from '../../utils/logger';

const log = createLogger('NodeConfig');

export function useNodeConfigSave(nodeConfig: NodeConfigType | null) {
  const [isSavingNode, setIsSavingNode] = useState(false);
  const [nodeSaveSuccess, setNodeSaveSuccess] = useState(false);
  const [nodeSaveError, setNodeSaveError] = useState<string | null>(null);

  const handleSaveNodeConfig = async () => {
    if (!nodeConfig) return;

    setIsSavingNode(true);
    setNodeSaveError(null);
    setNodeSaveSuccess(false);

    try {
      await adminApi.updateNodeConfig(nodeConfig);
      setNodeSaveSuccess(true);
      setTimeout(() => setNodeSaveSuccess(false), 3000);
    } catch (error) {
      log.error('Failed to save node config', { error });
      setNodeSaveError('Failed to save node configuration');
    } finally {
      setIsSavingNode(false);
    }
  };

  return {
    isSavingNode,
    nodeSaveSuccess,
    nodeSaveError,
    handleSaveNodeConfig,
  };
}
