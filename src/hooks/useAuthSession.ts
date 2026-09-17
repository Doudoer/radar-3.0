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

  useEffect(() => {
    if (!authenticated) {
      setChecking(false);
      return;
    }

    apiFetch('/auth/me')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => setUser(payload.user))
      .catch(() => {
        sessionStorage.removeItem('radar_authenticated');
        setAuthenticated(false);
        setUser(null);
      })
      .finally(() => setChecking(false));
  }, [authenticated]);

  const login = useCallback((authenticatedUser: AuthUser) => {
    sessionStorage.setItem('radar_authenticated', 'true');
    setUser(authenticatedUser);
    setAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    sessionStorage.removeItem('radar_authenticated');
    setAuthenticated(false);
    setUser(null);
  }, []);

  return {
    authenticated,
    checking,
    user,
    role: user?.role?.toLowerCase() === 'admin' ? 'admin' as const : 'operador' as const,
    login,
    logout,
  };
};
