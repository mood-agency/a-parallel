import React, { useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { MobilePage } from './components/MobilePage';
import { PreviewBrowser } from './components/PreviewBrowser';
import './globals.css';
// Eagerly import so the persisted theme is applied before first paint
import './stores/settings-store';
import './i18n/config';

// The preview window sets this flag via Tauri's initialization_script
const isPreviewWindow = !!(window as unknown as { __PREVIEW_MODE__: unknown }).__PREVIEW_MODE__;

// Matches Tailwind's `md` breakpoint (768px)
const mobileQuery = window.matchMedia('(max-width: 767px)');
const subscribe = (cb: () => void) => {
  mobileQuery.addEventListener('change', cb);
  return () => mobileQuery.removeEventListener('change', cb);
};
const getSnapshot = () => mobileQuery.matches;

function ResponsiveShell() {
  const isMobile = useSyncExternalStore(subscribe, getSnapshot);
  return isMobile ? <MobilePage /> : <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPreviewWindow ? (
      <PreviewBrowser />
    ) : (
      <BrowserRouter>
        <ResponsiveShell />
      </BrowserRouter>
    )}
  </React.StrictMode>
);
