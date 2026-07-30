import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { extractErrorMessage } from '@sanctuary/shared/utils/errors';
import { useUser } from '../../../contexts/UserContext';
import { useErrorHandler } from '../../../hooks/useErrorHandler';
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
  const showInfoRef = useRef(showInfo);
  const requestGenerationRef = useRef(0);
  const [loadState, setLoadState] = useState<{
    data: LoadedSendTransactionPageData;
    error: string | null;
    loading: boolean;
    ownerWalletId: string | undefined;
  }>({
    data: emptySendTransactionPageData,
    error: null,
    loading: true,
    ownerWalletId: undefined,
  });

  const routeState = (location.state as SendTransactionRouteState | null) ?? {};
  const draftData = routeState.draft;
  const preSelectedUTXOs = routeState.preSelected;
  const userId = user?.id;

  useEffect(() => {
    showInfoRef.current = showInfo;
  }, [showInfo]);

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    let active = true;
    const ownsRequest = () => (
      active && requestGenerationRef.current === generation
    );

    setLoadState({
      data: emptySendTransactionPageData,
      error: null,
      loading: Boolean(id && userId),
      ownerWalletId: id,
    });

    if (!id || !userId) {
      return () => {
        active = false;
        requestGenerationRef.current += 1;
      };
    }

    const load = async () => {
      try {
        const result = await loadSendTransactionPageData({
          draftData,
          preSelectedUTXOs,
          showInfo: (message) => {
            if (ownsRequest()) showInfoRef.current(message);
          },
          userId,
          walletId: id,
        });
        if (!ownsRequest()) return;

        if (result.kind === 'readOnly') {
          log.warn('Read-only wallet role attempted to access send page', { walletId: id });
          navigate(`/wallets/${id}`, { replace: true });
          setLoadState((current) => ({ ...current, loading: false }));
          return;
        }

        setLoadState({
          data: result.data,
          error: null,
          loading: false,
          ownerWalletId: id,
        });
      } catch (loadError) {
        if (!ownsRequest()) return;
        setLoadState({
          data: emptySendTransactionPageData,
          error: extractErrorMessage(loadError),
          loading: false,
          ownerWalletId: id,
        });
      }
    };
    void load();

    return () => {
      active = false;
      requestGenerationRef.current += 1;
    };
  }, [id, userId, draftData, preSelectedUTXOs, navigate]);

  const ownsCurrentRoute = loadState.ownerWalletId === id;
  const pageData = ownsCurrentRoute
    ? loadState.data
    : emptySendTransactionPageData;
  const loading = ownsCurrentRoute ? loadState.loading : true;
  const error = ownsCurrentRoute ? loadState.error : null;

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
