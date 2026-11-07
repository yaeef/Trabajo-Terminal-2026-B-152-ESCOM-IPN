// src/store/RecuperacionSessionContext.tsx
//
// Estado efímero de la sesión de recuperación para el Beneficiario
// Principal (BP) — SOLO vive en memoria de esta pestaña. Nada aquí se
// persiste nunca (ni servidor ni IndexedDB): al cerrar/refrescar la
// pestaña se pierde, y hay que re-derivar todo desde la pass-phrase de
// sesión (ver crypto/recuperacionCrypto.ts).

import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { wipe } from '../crypto/sensitiveMemory';

export interface BpSessionState {
    pid: string;
    privateKey: Uint8Array; // X25519, re-derivado de la pass-phrase de sesión
    dek: Uint8Array | null; // solo una vez reconstruida con éxito
    nombreDeclarado?: string; // solo se conoce si esta pestaña fundó la sesión
    reconstruidoEn?: string; // ISO — cuándo se reconstruyó la DEK en ESTA pestaña
}

interface RecuperacionSessionValue {
    bp: BpSessionState | null;
    setBp: (s: BpSessionState | null) => void;
    setDek: (dek: Uint8Array | null) => void;
    clear: () => void;
}

const Ctx = createContext<RecuperacionSessionValue | undefined>(undefined);

export function RecuperacionSessionProvider({ children }: { children: ReactNode }) {
    const [bp, setBpState] = useState<BpSessionState | null>(null);
    const bpRef = useRef<BpSessionState | null>(null);
    bpRef.current = bp;

    const setBp = (s: BpSessionState | null) => {
        const prev = bpRef.current;
        if (prev && prev !== s) {
            wipe(prev.privateKey);
            wipe(prev.dek);
        }
        setBpState(s);
    };

    const setDek = (dek: Uint8Array | null) => {
        setBpState((prev) =>
            prev ? { ...prev, dek, reconstruidoEn: dek ? new Date().toISOString() : prev.reconstruidoEn } : prev,
        );
    };

    return <Ctx.Provider value={{ bp, setBp, setDek, clear: () => setBp(null) }}>{children}</Ctx.Provider>;
}

export function useRecuperacionSession() {
    const ctx = useContext(Ctx);
    if (!ctx) throw new Error('useRecuperacionSession debe usarse dentro de <RecuperacionSessionProvider>');
    return ctx;
}
