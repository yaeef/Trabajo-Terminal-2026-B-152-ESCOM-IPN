import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from './store/AuthContext';
import { NoticeProvider } from './store/NoticeContext';
import { RecuperacionSessionProvider } from './store/RecuperacionSessionContext';
import ProtectedRoute from './routes/ProtectedRoute';
import AdminRoute from './routes/AdminRoute';
import Home from './pages/Home';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import ConfirmarRegistro from './pages/auth/ConfirmarRegistro';
import Dashboard from './pages/Dashboard';
import Recuperacion from './pages/Recuperacion';
import SesionBP from './pages/recuperacion/SesionBP';
import SesionCustodio from './pages/recuperacion/SesionCustodio';
import ActivosRecuperados from './pages/recuperacion/ActivosRecuperados';
import Perfil from './pages/Perfil';
import Configuracion from './pages/Configuracion';
import ConfirmarCorreoSecundario from './pages/ConfirmarCorreoSecundario';
import ConfirmarCustodio from './pages/ConfirmarCustodio';
import HistorialCheckins from './pages/HistorialCheckins';
import MisBovedas from './pages/bovedas/MisBovedas';
import NuevaBoveda from './pages/bovedas/NuevaBoveda';
import GestionarBoveda from './pages/bovedas/GestionarBoveda';
import AgregarActivos from './pages/bovedas/AgregarActivos';
import Custodios from './pages/Custodios';
import Suscripcion from './pages/Suscripcion';
import CuentaEnEliminacion from './pages/CuentaEnEliminacion';
import PatrimonioLiberado from './pages/PatrimonioLiberado';
import Atestacion from './pages/Atestacion';
import AdminPropietarios from './pages/admin/AdminPropietarios';
import AdminPropietarioDetalle from './pages/admin/AdminPropietarioDetalle';
import AdminNotificaciones from './pages/admin/AdminNotificaciones';
import AdminAuditoria from './pages/admin/AdminAuditoria';

function App() {
    return (
        <NoticeProvider>
            <Router>
                <AuthProvider>
                    <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/login" element={<Login />} />
                        <Route path="/register" element={<Register />} />
                        <Route path="/recuperar-password" element={<ForgotPassword />} />
                        <Route path="/reset-password" element={<ResetPassword />} />
                        {/* Pública: llega desde el enlace del correo de confirmación del registro */}
                        <Route path="/confirmar-registro" element={<ConfirmarRegistro />} />
                        {/* Portal de custodios/bóveda (CU-029 a CU-035): localizar por PID, sesión
                            efímera de recuperación (BP + custodios) y descarga de activos.
                            Pública — quienes participan no tienen cuenta en el sistema; el
                            RecuperacionSessionProvider guarda la llave del BP SOLO en memoria
                            de esta pestaña (nunca se persiste, ver store/RecuperacionSessionContext). */}
                        <Route element={<RecuperacionSessionProvider><Outlet /></RecuperacionSessionProvider>}>
                            <Route path="/recuperacion" element={<Recuperacion />} />
                            <Route path="/recuperacion/:pid" element={<Recuperacion />} />
                            <Route path="/recuperacion/:pid/bp" element={<SesionBP />} />
                            <Route path="/recuperacion/:pid/custodio" element={<SesionCustodio />} />
                            <Route path="/recuperacion/:pid/activos" element={<ActivosRecuperados />} />
                        </Route>
                        {/* Pública: llega desde el link del correo de confirmación (CU-016) */}
                        <Route path="/confirmar-correo" element={<ConfirmarCorreoSecundario />} />
                        {/* Pública: el custodio confirma su canal desde el link del correo (CU-011) */}
                        <Route path="/confirmar-custodio" element={<ConfirmarCustodio />} />
                        {/* Pública: el custodio vota vida/fallecimiento en el Interruptor de Hombre Muerto */}
                        <Route path="/atestacion" element={<Atestacion />} />

                        <Route element={<ProtectedRoute />}>
                            <Route path="/dashboard" element={<Dashboard />} />
                            <Route path="/perfil" element={<Perfil />} />
                            <Route path="/configuracion" element={<Configuracion />} />
                            <Route path="/historial-checkins" element={<HistorialCheckins />} />
                            <Route path="/bovedas" element={<MisBovedas />} />
                            <Route path="/bovedas/nueva" element={<NuevaBoveda />} />
                            <Route path="/bovedas/:id/activos/nuevo" element={<AgregarActivos />} />
                            <Route path="/bovedas/:id" element={<GestionarBoveda />} />
                            <Route path="/custodios" element={<Custodios />} />
                            <Route path="/suscripcion" element={<Suscripcion />} />
                            <Route path="/cuenta-en-eliminacion" element={<CuentaEnEliminacion />} />
                            <Route path="/patrimonio-liberado" element={<PatrimonioLiberado />} />

                            {/* Panel admin (soporte/operación): rol admin, ver AdminRoute */}
                            <Route element={<AdminRoute />}>
                                <Route path="/admin" element={<AdminPropietarios />} />
                                <Route path="/admin/propietarios/:id" element={<AdminPropietarioDetalle />} />
                                <Route path="/admin/notificaciones" element={<AdminNotificaciones />} />
                                <Route path="/admin/auditoria" element={<AdminAuditoria />} />
                            </Route>
                        </Route>

                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </AuthProvider>
            </Router>
        </NoticeProvider>
    );
}

export default App;