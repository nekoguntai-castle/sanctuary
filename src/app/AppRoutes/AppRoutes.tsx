import { useLocation } from 'react-router-dom';
import { Login } from '../../components/Login';
import { VerifyEmailPage } from '../../components/VerifyEmail/VerifyEmailPage';
import { DashboardSkeleton } from '../../components/ui/Skeleton';
import { AuthenticatedAppShell } from './AuthenticatedAppShell';
import { useAppRoutesController } from './useAppRoutesController';

export function AppRoutes() {
  const controller = useAppRoutesController();
  const location = useLocation();

  // The emailed link works with or without a session, so it comes first.
  if (location.pathname === '/verify-email') {
    return <VerifyEmailPage />;
  }

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
