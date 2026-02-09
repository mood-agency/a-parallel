import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { PreviewBrowser } from './components/PreviewBrowser';
import './globals.css';
// Eagerly import so the persisted theme is applied before first paint
import './stores/settings-store';
import './i18n/config';

// The preview window sets this flag via Tauri's initialization_script
const isPreviewWindow = !!(window as unknown as { __PREVIEW_MODE__: unknown }).__PREVIEW_MODE__;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPreviewWindow ? (
      <PreviewBrowser />
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </React.StrictMode>
);
