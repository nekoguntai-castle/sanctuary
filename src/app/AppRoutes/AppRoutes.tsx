import { Login } from '../../../components/Login';
import { AuthenticatedAppShell } from './AuthenticatedAppShell';
import { useAppRoutesController } from './useAppRoutesController';

export function AppRoutes() {
  const controller = useAppRoutesController();

  if (!controller.isAuthenticated) {
    return <Login />;
  }

  return <AuthenticatedAppShell controller={controller} />;
}
