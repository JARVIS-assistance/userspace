import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LoginScreen from './LoginScreen';
import App from './App';
import './runtime.css';

function Root() {
    const [token, setToken] = useState<string | null>(null);

    const handleLogout = () => {
        localStorage.removeItem("jarvis_token");
        setToken(null);
    };

    if (!token) {
        return <LoginScreen onLoginSuccess={(t) => setToken(t)} />;
    }

    return <App token={token} onLogout={handleLogout} />;
}

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Root element not found');
}

createRoot(rootElement).render(<Root />);
