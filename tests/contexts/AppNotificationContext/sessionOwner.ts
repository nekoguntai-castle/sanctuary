/**
 * Who the AppNotificationProvider under test believes is signed in. Kept in its
 * own import-free module so the UserContext mock factory can load it without
 * re-entering the test harness.
 */
export const sessionOwner: { userId: string | null } = { userId: 'user-1' };
