import { createContext, useContext, useState, type ReactNode } from 'react';
import NoticeModal, { type NoticeType } from '../components/common/NoticeModal';

interface NoticeState {
    type: NoticeType;
    title: string;
    message: string;
}

interface NoticeContextValue {
    notifyError: (message: string, title?: string) => void;
    notifyWarning: (message: string, title?: string) => void;
    notifySuccess: (message: string, title?: string) => void;
}

const DEFAULT_TITLES: Record<NoticeType, string> = {
    // Genérico a propósito: cubre tanto fallos técnicos como datos
    // incorrectos del usuario (p. ej. "Credenciales incorrectas" no es
    // un "error" del sistema, así que el título no debe presuponer culpa).
    error: 'No se pudo continuar',
    warning: 'Atención',
    success: 'Listo',
};

const NoticeContext = createContext<NoticeContextValue | undefined>(undefined);

export function NoticeProvider({ children }: { children: ReactNode }) {
    const [notice, setNotice] = useState<NoticeState | null>(null);

    const notify = (type: NoticeType) => (message: string, title?: string) => {
        setNotice({ type, title: title || DEFAULT_TITLES[type], message });
    };

    const value: NoticeContextValue = {
        notifyError: notify('error'),
        notifyWarning: notify('warning'),
        notifySuccess: notify('success'),
    };

    return (
        <NoticeContext.Provider value={value}>
            {children}
            {notice && (
                <NoticeModal
                    type={notice.type}
                    title={notice.title}
                    message={notice.message}
                    onClose={() => setNotice(null)}
                />
            )}
        </NoticeContext.Provider>
    );
}

export function useNotice() {
    const ctx = useContext(NoticeContext);
    if (!ctx) throw new Error('useNotice debe usarse dentro de <NoticeProvider>');
    return ctx;
}
