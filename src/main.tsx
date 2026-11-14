import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { FeedbackProvider } from './components/FeedbackProvider';
import { InstallAppPrompt } from './components/InstallAppPrompt';
import { isYardContext, manifestHrefForContext } from './utils/installPrompt';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/material-symbols-outlined';
import './index.css';
import './horizon.css';

const yardContext = typeof window !== 'undefined' && isYardContext(window.location);

if (typeof document !== 'undefined') {
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', manifestHrefForContext(yardContext));
  document
    .querySelector('meta[name="apple-mobile-web-app-title"]')
    ?.setAttribute('content', yardContext ? 'RADAR Patio' : 'RADAR');
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => undefined);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FeedbackProvider>
      <App />
      <InstallAppPrompt variant={yardContext ? 'yard' : 'office'} />
    </FeedbackProvider>
  </StrictMode>,
);
