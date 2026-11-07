import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { applyTheme, getTheme } from './theme';
import './theme.css';

// Aplica el tema guardado antes del primer render (evita parpadeo).
applyTheme(getTheme());

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>
);
