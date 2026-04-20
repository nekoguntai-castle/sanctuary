import type { Notification } from '../../../components/NotificationToast';

export interface AppPreferenceState {
  isDarkMode: boolean;
  backgroundPattern: string;
  patternOpacity: number;
  shouldRenderAnimatedBackground: boolean;
}

export interface AppRoutesController {
  isAuthenticated: boolean;
  logout: () => void;
  notifications: Notification[];
  removeNotification: (id: string) => void;
  preferences: AppPreferenceState;
  showPasswordModal: boolean;
  handlePasswordChanged: () => Promise<void>;
  toggleTheme: () => void;
}
