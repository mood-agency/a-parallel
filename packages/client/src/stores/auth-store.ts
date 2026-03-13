import type { SafeUser } from '@funny/shared';
import { create } from 'zustand';

import { authClient } from '@/lib/auth-client';

interface AuthState {
  user: SafeUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  /** Check Better Auth session */
  initialize: () => Promise<void>;
  /** Login with username + password */
  login: (username: string, password: string) => Promise<void>;
  /** Logout */
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, _get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  initialize: async () => {
    set({ isLoading: true });

    try {
      const session = await authClient.getSession();
      if (session.data?.user) {
        const u = session.data.user as any;
        set({
          isAuthenticated: true,
          isLoading: false,
          user: {
            id: u.id,
            username: u.username || u.name || 'user',
            displayName: u.name || u.username || 'User',
            role: u.role || 'user',
          },
        });
      } else {
        set({ isAuthenticated: false, isLoading: false, user: null });
      }
    } catch (err) {
      console.error('[auth-store] initialization error:', err);
      set({ isAuthenticated: false, isLoading: false });
    }
  },

  login: async (username: string, password: string) => {
    const result = await authClient.signIn.username({
      username,
      password,
    });

    if (result.error) {
      throw new Error(result.error.message || 'Login failed');
    }

    const u = result.data?.user as any;
    if (u) {
      set({
        isAuthenticated: true,
        user: {
          id: u.id,
          username: u.username || u.name || 'user',
          displayName: u.name || u.username || 'User',
          role: u.role || 'user',
        },
      });
    }
  },

  logout: async () => {
    try {
      await authClient.signOut();
    } catch {
      // Ignore errors
    }
    set({ isAuthenticated: false, user: null });
  },
}));
