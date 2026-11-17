export interface RememberedCredentials {
  email: string;
  password: string;
  remember: boolean;
}

const storageKey = (scope: 'main' | 'yard') => `radar_remembered_credentials_${scope}`;

export const loadRememberedCredentials = (scope: 'main' | 'yard'): RememberedCredentials => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { email: '', password: '', remember: false };
    }
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return { email: '', password: '', remember: false };
    const parsed = JSON.parse(raw) as Partial<RememberedCredentials>;
    if (!parsed || typeof parsed.email !== 'string' || typeof parsed.password !== 'string') {
      return { email: '', password: '', remember: false };
    }
    return {
      email: parsed.email,
      password: parsed.password,
      remember: Boolean(parsed.email || parsed.password),
    };
  } catch {
    return { email: '', password: '', remember: false };
  }
};

export const saveRememberedCredentials = (
  scope: 'main' | 'yard',
  remember: boolean,
  email: string,
  password: string,
): void => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!remember) {
      window.localStorage.removeItem(storageKey(scope));
      return;
    }
    window.localStorage.setItem(
      storageKey(scope),
      JSON.stringify({ email, password, remember: true }),
    );
  } catch {
    // Ignore storage quota or private-mode errors
  }
};
