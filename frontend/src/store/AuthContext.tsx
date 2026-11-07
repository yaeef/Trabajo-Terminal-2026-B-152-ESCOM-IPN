import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authService } from '../services/auth.service';
import type { User } from '../types/auth.types';

interface AuthContextValue {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (username: string, password: string) => Promise<User | null>;
    logout: () => void;
    refreshUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const refreshUser = async (): Promise<User | null> => {
        if (!authService.getToken()) {
            setUser(null);
            return null;
        }
        try {
            const me = await authService.getMe();
            setUser(me);
            return me;
        } catch {
            // Token inválido/expirado: limpiamos sesión
            authService.logout();
            setUser(null);
            return null;
        }
    };

    // Al cargar la app, valida si el token guardado sigue siendo válido
    useEffect(() => {
        refreshUser().finally(() => setIsLoading(false));
    }, []);

    const login = async (username: string, password: string): Promise<User | null> => {
        await authService.login(username, password);
        return refreshUser();
    };

    const logout = () => {
        authService.logout();
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout, refreshUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
    return ctx;
}