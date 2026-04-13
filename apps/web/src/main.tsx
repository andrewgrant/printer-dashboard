import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { ApiDocs } from './ApiDocs.js';
import './styles.css';

const isApiDocs = window.location.pathname.replace(/\/+$/, '') === '/site/api';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isApiDocs ? <ApiDocs /> : <App />}</React.StrictMode>,
);
