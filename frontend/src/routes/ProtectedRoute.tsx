import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';

const LOCK_PATH = '/cuenta-en-eliminacion';
const LIBERADO_PATH = '/patrimonio-liberado';

export default function ProtectedRoute() {
    const { isAuthenticated, isLoading, user } = useAuth();
    const location = useLocation();

    if (isLoading) return null; // evita un parpadeo hacia /login mientras valida el token
    if (!isAuthenticated) return <Navigate to="/login" replace />;

    // Interruptor de Hombre Muerto ya activado: el panel queda bloqueado por
    // completo, solo se permite la pantalla de resumen (PatrimonioLiberado).
    // Se revisa antes que la cola de eliminación porque, si ambas cosas
    // coinciden, lo relevante para el propietario es que ya se liberó.
    const liberado = user?.status_dms === 'liberado';
    if (liberado && location.pathname !== LIBERADO_PATH) {
        return <Navigate to={LIBERADO_PATH} replace />;
    }
    if (!liberado && location.pathname === LIBERADO_PATH) {
        return <Navigate to="/dashboard" replace />;
    }

    // Cuenta en cola de eliminación: solo se permite la pantalla de bloqueo.
    const enCola = Boolean(user?.eliminacion_solicitada_en);
    if (enCola && location.pathname !== LOCK_PATH) {
        return <Navigate to={LOCK_PATH} replace />;
    }
    if (!enCola && location.pathname === LOCK_PATH) {
        return <Navigate to="/dashboard" replace />;
    }

    return <Outlet />;
}
