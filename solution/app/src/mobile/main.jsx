import React from 'react';
import { createRoot } from 'react-dom/client';
import './mobile.css';
import MobileApp from './MobileApp.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>,
);
