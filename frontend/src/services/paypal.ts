// Carga perezosa del SDK de PayPal (Buttons). El script viene de paypal.com;
// esto es una app web normal, no un Artifact, así que no hay CSP que lo bloquee.

let cargando: Promise<PayPalNamespace> | null = null;
let clienteCargado: string | null = null;

export interface PayPalButtonsActions {
    order: {
        capture: () => Promise<unknown>;
    };
}

export interface PayPalNamespace {
    Buttons: (opts: {
        style?: Record<string, unknown>;
        createOrder: () => Promise<string> | string;
        onApprove: (data: { orderID: string }) => Promise<void> | void;
        onCancel?: () => void;
        onError?: (err: unknown) => void;
    }) => { render: (selector: string | HTMLElement) => Promise<void> };
}

export function loadPayPal(clientId: string, currency: string): Promise<PayPalNamespace> {
    const w = window as unknown as { paypal?: PayPalNamespace };
    if (w.paypal && clienteCargado === clientId) return Promise.resolve(w.paypal);
    if (cargando && clienteCargado === clientId) return cargando;

    clienteCargado = clientId;
    cargando = new Promise((resolve, reject) => {
        const prev = document.getElementById('paypal-sdk');
        if (prev) prev.remove();
        const s = document.createElement('script');
        s.id = 'paypal-sdk';
        s.src =
            `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}` +
            `&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons`;
        s.onload = () => {
            const ns = (window as unknown as { paypal?: PayPalNamespace }).paypal;
            ns ? resolve(ns) : reject(new Error('El SDK de PayPal cargó sin exponer `paypal`.'));
        };
        s.onerror = () => reject(new Error('No se pudo cargar el SDK de PayPal.'));
        document.head.appendChild(s);
    });
    return cargando;
}
