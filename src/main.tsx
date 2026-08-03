import 'regenerator-runtime/runtime';
import './utils/nodeGlobals';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeThemes } from './themes';

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
