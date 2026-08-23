import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

// Retire service workers and generated shell caches from the former installable build.
if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
if ('caches' in window) void caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('screenwriter-shell-')).map((key) => caches.delete(key))));
