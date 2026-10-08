import { useState, useEffect, useCallback } from 'react';

export type Theme = 'dark' | 'light';

export const useTheme = () => {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('radar_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark'; // Default to Cyberpunk Dark
  });

  const applyTheme = useCallback((newTheme: Theme) => {
    const root = document.documentElement;
    if (newTheme === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }
    localStorage.setItem('radar_theme', newTheme);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }, [applyTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    applyTheme(newTheme);
  }, [applyTheme]);

  return { theme, toggleTheme, setTheme, isDark: theme === 'dark' };
};
