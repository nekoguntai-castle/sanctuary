import 'regenerator-runtime/runtime';
import './utils/nodeGlobals';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeThemes } from './themes';

// Verification links emailed before the app was hash-routed point at
// /verify-email?token=...; forward them to the hash route the router reads.
if (window.location.pathname === '/verify-email') {
  window.history.replaceState(null, '', '/#/verify-email' + window.location.search);
}

// Initialize the theme system before rendering
initializeThemes();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
