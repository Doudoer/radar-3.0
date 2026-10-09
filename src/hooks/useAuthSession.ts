import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

export interface AuthUser {
  id?: number;
  name?: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
  role: string;
  permissions?: string[];
  theme?: string;
}

export const useAuthSession = () => {
  const [authenticated, setAuthenticated] = useState(() => sessionStorage.getItem('radar_authenticated') === 'true');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  const handleUnauthorized = useCallback(() => {
    sessionStorage.removeItem('radar_authenticated');
    setAuthenticated(false);
    setUser(null);
  }, []);

  useEffect(() => {
    window.addEventListener('radar:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('radar:unauthorized', handleUnauthorized);
    };
  }, [handleUnauthorized]);

  const refreshUser = useCallback(async () => {
    try {
      const response = await apiFetch('/auth/me');
      if (!response.ok) throw new Error('Unauthorized');
      const payload = await response.json();
      if (payload?.user) {
        setUser(payload.user);
      } else {
        handleUnauthorized();
      }
    } catch {
      handleUnauthorized();
    }
  }, [handleUnauthorized]);

  useEffect(() => {
    if (!authenticated) {
      setChecking(false);
      return;
    }

    refreshUser().finally(() => setChecking(false));
  }, [authenticated, refreshUser]);

  const login = useCallback((authenticatedUser: AuthUser) => {
    sessionStorage.setItem('radar_authenticated', 'true');
    setUser(authenticatedUser);
    setAuthenticated(true);
  }, []);

  const updateUser = useCallback((updated: Partial<AuthUser>) => {
    setUser((prev) => (prev ? { ...prev, ...updated } : null));
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    } finally {
      handleUnauthorized();
    }
  }, [handleUnauthorized]);

  return {
    authenticated,
    checking,
    user,
    role: user?.role?.toLowerCase() === 'admin' ? ('admin' as const) : ('operador' as const),
    login,
    updateUser,
    refreshUser,
    logout,
  };
};
