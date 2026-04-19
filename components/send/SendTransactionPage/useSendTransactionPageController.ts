import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useUser } from '../../../contexts/UserContext';
import { useErrorHandler } from '../../../hooks/useErrorHandler';
import { useLoadingState } from '../../../hooks/useLoadingState';
import { createLogger } from '../../../utils/logger';
import { loadSendTransactionPageData } from './loadSendTransactionPageData';
import {
  calculateFee,
  emptySendTransactionPageData,
} from './sendTransactionPageHelpers';
import type {
  LoadedSendTransactionPageData,
  SendTransactionPageController,
  SendTransactionRouteState,
} from './types';

const log = createLogger('SendTxPage');

export function useSendTransactionPageController(): SendTransactionPageController {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUser();
  const { showInfo } = useErrorHandler();
  const { loading, error, execute: runLoad } = useLoadingState({ initialLoading: true });
  const mountedRef = useRef(true);
  const [pageData, setPageData] = useState<LoadedSendTransactionPageData>(
    emptySendTransactionPageData
  );

  const routeState = (location.state as SendTransactionRouteState | null) ?? {};
  const draftData = routeState.draft;
  const preSelectedUTXOs = routeState.preSelected;

  useEffect(() => {
    mountedRef.current = true;

    if (!id || !user) return;

    runLoad(async () => {
      const result = await loadSendTransactionPageData({
        draftData,
        preSelectedUTXOs,
        showInfo,
        userId: user.id,
        walletId: id,
      });
      if (!mountedRef.current) return;

      if (result.kind === 'viewer') {
        log.warn('Viewer attempted to access send page', { walletId: id });
        navigate(`/wallets/${id}`, { replace: true });
        return;
      }

      setPageData(result.data);
    });

    return () => {
      mountedRef.current = false;
    };
  }, [id, user, draftData, preSelectedUTXOs, showInfo, runLoad, navigate]);

  const handleCancel = useCallback(() => {
    navigate(`/wallets/${id}`);
  }, [navigate, id]);

  return {
    ...pageData,
    calculateFee,
    error,
    handleCancel,
    loading,
    walletId: id,
  };
}
