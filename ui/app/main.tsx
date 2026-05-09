import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import LoginScreen from './LoginScreen';
import App from './App';
import './runtime.css';

function Root() {
    const [token, setToken] = useState<string | null>(null);
    const [booting, setBooting] = useState(true);

    useEffect(() => {
        const stored = localStorage.getItem("jarvis_token");
        if (stored) {
            setToken(stored);
        }
        setBooting(false);
    }, []);

    const handleLogout = () => {
        localStorage.removeItem("jarvis_token");
        setToken(null);
    };

    if (booting) {
        return <p style={{ color: "#000", padding: 24 }}>시스템을 초기화 중입니다...</p>;
    }

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
