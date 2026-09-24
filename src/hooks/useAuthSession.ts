import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

interface AuthUser {
  id?: number;
  name?: string;
  email?: string;
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

  useEffect(() => {
    if (!authenticated) {
      setChecking(false);
      return;
    }

    apiFetch('/auth/me')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        if (!payload?.user) {
          handleUnauthorized();
        } else {
          setUser(payload.user);
        }
      })
      .catch(() => {
        handleUnauthorized();
      })
      .finally(() => setChecking(false));
  }, [authenticated, handleUnauthorized]);

  const login = useCallback((authenticatedUser: AuthUser) => {
    sessionStorage.setItem('radar_authenticated', 'true');
    setUser(authenticatedUser);
    setAuthenticated(true);
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
    role: user?.role?.toLowerCase() === 'admin' ? 'admin' as const : 'operador' as const,
    login,
    logout,
  };
};
