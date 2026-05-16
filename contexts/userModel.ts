import type { AuthUser } from '@sanctuary/shared/types/api';
import type { User, UserPreferences } from '../types';
import {
  asPreferenceRecord,
  type PreferenceRecord,
} from '../utils/preferencePaths';

export const DEFAULT_AUTHENTICATED_PREFERENCES: UserPreferences = {
  darkMode: true,
  theme: 'sanctuary',
  background: 'zen',
  unit: 'sats',
  fiatCurrency: 'USD',
  showFiat: true,
  priceProvider: 'auto',
};

export type UserPreferenceRecord = Partial<UserPreferences> & PreferenceRecord;

export function getUserPreferenceRecord(user: User): UserPreferenceRecord {
  return asPreferenceRecord(user.preferences) as UserPreferenceRecord;
}

export function toContextUser(apiUser: AuthUser): User {
  return {
    id: apiUser.id,
    username: apiUser.username,
    email: apiUser.email,
    emailVerified: apiUser.emailVerified,
    isAdmin: apiUser.isAdmin,
    preferences: apiUser.preferences,
    createdAt: apiUser.createdAt,
    twoFactorEnabled: apiUser.twoFactorEnabled,
    usingDefaultPassword: apiUser.usingDefaultPassword,
  };
}
