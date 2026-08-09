import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import * as aiApi from '../../api/ai';
import {
  createRequestOwnership,
  type RequestOwnership,
  type RouteToken,
} from '../../hooks/requestOwnership';
import { createLogger } from '../../utils/logger';

const log = createLogger('AIQueryInput');

interface UseAIQueryInputControllerArgs {
  walletId: string;
  ownershipKey: string;
  onQueryResult?: (result: aiApi.NaturalQueryResult | null) => void;
}

interface OwnedAIQueryState {
  owner: RouteToken;
  query: string;
  loading: boolean;
  error: string | null;
  result: aiApi.NaturalQueryResult | null;
  showExamples: boolean;
}

const createEmptyState = (owner: RouteToken): OwnedAIQueryState => ({
  owner,
  query: '',
  loading: false,
  error: null,
  result: null,
  showExamples: false,
});

const getAIQueryErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';

  if (message.includes('503') || message.includes('not enabled')) {
    return 'AI is not enabled. Configure it in Admin → AI Settings.';
  }

  if (message.includes('429')) {
    return 'AI rate limit reached — too many requests in a short period. Please wait a minute before trying again.';
  }

  return 'Failed to process query. AI may be unavailable.';
};

export const formatNaturalQueryResult = (result: aiApi.NaturalQueryResult): string => {
  const parts: string[] = [`Type: ${result.type}`];

  if (result.filter && Object.keys(result.filter).length > 0) {
    parts.push(`Filter: ${JSON.stringify(result.filter)}`);
  }

  if (result.sort) {
    parts.push(`Sort: ${result.sort.field} (${result.sort.order})`);
  }

  if (result.limit) {
    parts.push(`Limit: ${result.limit}`);
  }

  if (result.aggregation) {
    parts.push(`Aggregation: ${result.aggregation}`);
  }

  return parts.join(' • ');
};

export const useAIQueryInputController = ({
  walletId,
  ownershipKey,
  onQueryResult,
}: UseAIQueryInputControllerArgs) => {
  const ownershipRef = useRef<RequestOwnership | null>(null);
  if (!ownershipRef.current) {
    ownershipRef.current = createRequestOwnership(ownershipKey);
  }
  const ownership = ownershipRef.current;
  const activeRequest = useRef<AbortController | null>(null);
  ownership.setRoute(ownershipKey);
  const routeToken = ownership.captureRoute(ownershipKey);
  const [state, setState] = useState<OwnedAIQueryState>(() => createEmptyState(routeToken));

  const renderedState = ownership.isRouteOwner(state.owner)
    ? state
    : createEmptyState(routeToken);

  const updateOwnedState = useCallback((
    update: (current: OwnedAIQueryState) => OwnedAIQueryState
  ) => {
    if (!ownership.isRouteOwner(routeToken)) return;
    setState(current => update(
      ownership.isRouteOwner(current.owner) ? current : createEmptyState(routeToken)
    ));
  }, [ownership, routeToken]);

  const abortActiveRequest = useCallback(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
  }, []);

  useEffect(() => {
    abortActiveRequest();
  }, [abortActiveRequest, ownershipKey]);

  useEffect(() => () => {
    ownership.invalidate();
    abortActiveRequest();
  }, [abortActiveRequest, ownership]);

  const setQuery = useCallback((query: string) => {
    updateOwnedState(current => ({ ...current, query }));
  }, [updateOwnedState]);

  const setShowExamples = useCallback((showExamples: boolean) => {
    updateOwnedState(current => ({ ...current, showExamples }));
  }, [updateOwnedState]);

  const handleSubmit = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();

    const trimmedQuery = renderedState.query.trim();
    if (!trimmedQuery) return;

    abortActiveRequest();
    const token = ownership.beginFetch(ownershipKey);
    const requestController = new AbortController();
    activeRequest.current = requestController;
    updateOwnedState(current => ({
      ...current,
      loading: true,
      error: null,
      result: null,
    }));

    try {
      const response = await aiApi.executeNaturalQuery({
        query: trimmedQuery,
        walletId,
      }, requestController.signal);

      if (!ownership.isFetchOwner(token)) return;
      updateOwnedState(current => ({ ...current, result: response }));
      onQueryResult?.(response);
    } catch (caughtError) {
      if (!ownership.isFetchOwner(token)) return;
      log.error('AI query failed', { error: caughtError });
      updateOwnedState(current => ({
        ...current,
        error: getAIQueryErrorMessage(caughtError),
      }));
    } finally {
      if (ownership.isFetchOwner(token)) {
        updateOwnedState(current => ({ ...current, loading: false }));
      }
      if (activeRequest.current === requestController) {
        activeRequest.current = null;
      }
    }
  }, [
    abortActiveRequest,
    onQueryResult,
    ownership,
    ownershipKey,
    renderedState.query,
    updateOwnedState,
    walletId,
  ]);

  const handleExampleClick = useCallback((example: string) => {
    updateOwnedState(current => ({ ...current, query: example, showExamples: false }));
  }, [updateOwnedState]);

  const clearQuery = useCallback(() => {
    if (!ownership.isRouteOwner(routeToken)) return;
    ownership.invalidate();
    abortActiveRequest();
    setState(createEmptyState(ownership.captureRoute(ownershipKey)));
    onQueryResult?.(null);
  }, [abortActiveRequest, onQueryResult, ownership, ownershipKey, routeToken]);

  const dismissError = useCallback(() => {
    updateOwnedState(current => ({ ...current, error: null }));
  }, [updateOwnedState]);

  return {
    query: renderedState.query,
    loading: renderedState.loading,
    error: renderedState.error,
    result: renderedState.result,
    showExamples: renderedState.showExamples,
    setQuery,
    setShowExamples,
    handleSubmit,
    handleExampleClick,
    clearQuery,
    dismissError,
  };
};

export type AIQueryInputController = ReturnType<typeof useAIQueryInputController>;
