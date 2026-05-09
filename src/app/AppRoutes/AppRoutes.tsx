import { Login } from '../../../components/Login';
import { DashboardSkeleton } from '../../../components/ui/Skeleton';
import { AuthenticatedAppShell } from './AuthenticatedAppShell';
import { useAppRoutesController } from './useAppRoutesController';

export function AppRoutes() {
  const controller = useAppRoutesController();

  if (controller.isLoading) {
    return (
      <div data-testid="auth-bootstrap-loading">
        <DashboardSkeleton />
      </div>
    );
  }

  if (!controller.isAuthenticated) {
    return <Login />;
  }

  return <AuthenticatedAppShell controller={controller} />;
}
