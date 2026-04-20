import { Navigate, Route, Routes } from 'react-router-dom';
import { appRedirectRoutes, appRouteDefinitions, renderAppRouteElement } from '../appRoutes';
import type { AppRedirectRoute, AppRouteDefinition } from '../appRoutes';

export function AppRouteSwitch() {
  return (
    <Routes>
      {appRouteDefinitions.map(renderRoute)}
      {appRedirectRoutes.map(renderRedirect)}
    </Routes>
  );
}

function renderRoute(route: AppRouteDefinition) {
  return <Route key={route.id} path={route.path} element={renderAppRouteElement(route)} />;
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
