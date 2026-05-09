import { Navigate, Route, Routes } from 'react-router-dom';
import { appRedirectRoutes, appRouteDefinitions, renderAppRouteElement } from '../appRoutes';
import type { AppRedirectRoute, AppRouteDefinition } from '../appRoutes';
import { getRequiredCapabilityGateState } from '../capabilities';
import { useAppCapabilityStates } from '../../../hooks/useAppCapabilities';

export function AppRouteSwitch() {
  return (
    <Routes>
      {appRouteDefinitions.map(renderRoute)}
      {appRedirectRoutes.map(renderRedirect)}
    </Routes>
  );
}

function renderRoute(route: AppRouteDefinition) {
  return <Route key={route.id} path={route.path} element={<AppRouteElement route={route} />} />;
}

function renderRedirect(route: AppRedirectRoute) {
  return (
    <Route
      key={route.path}
      path={route.path}
      element={<Navigate to={route.to} replace={route.replace} />}
    />
  );
}

function AppRouteElement({ route }: { route: AppRouteDefinition }) {
  if (!route.requiredCapabilities?.length) {
    return renderAppRouteElement(route);
  }

  return <CapabilityGatedRoute route={route} />;
}

function CapabilityGatedRoute({ route }: { route: AppRouteDefinition }) {
  const capabilityStates = useAppCapabilityStates();
  const gateState = getRequiredCapabilityGateState(
    route.requiredCapabilities,
    capabilityStates
  );

  if (gateState === 'loading') {
    return <div data-testid="route-capability-loading">{route.fallback}</div>;
  }

  if (gateState === 'unavailable') {
    return (
      <div
        className="p-8 text-center text-sanctuary-600 dark:text-sanctuary-300"
        data-testid="route-capability-unavailable"
      >
        Feature unavailable
      </div>
    );
  }

  return renderAppRouteElement(route);
}
