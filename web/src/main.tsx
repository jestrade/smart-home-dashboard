import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyHomeTheme } from './home';
import './styles.css';

applyHomeTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
