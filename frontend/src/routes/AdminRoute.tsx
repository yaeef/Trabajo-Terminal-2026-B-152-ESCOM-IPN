import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';

/**
 * Anidado dentro de <ProtectedRoute>: ese ya validó la sesión, este solo
 * exige rol admin. Un propietario que entre a mano a /admin va a /dashboard.
 */
export default function AdminRoute() {
    const { user } = useAuth();
    if (user?.rol !== 'admin') return <Navigate to="/dashboard" replace />;
    return <Outlet />;
}
