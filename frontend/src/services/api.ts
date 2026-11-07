import axios from 'axios';

// Si VITE_API_URL no se definió explícitamente, usa el mismo host con el que
// se cargó la página en vez de "localhost" fijo. Necesario para probar desde
// el celular en la LAN: "localhost" horneado en el bundle apuntaría al
// celular mismo (nunca a la máquina que corre el backend), y cualquier
// llamada a la API fallaría por conexión — se ve como "credenciales
// inválidas" porque el error no trae response, no porque los datos estén
// mal. Con esto, entrar por localhost:5173 pega a localhost:8000, y entrar
// por 192.168.x.x:5173 pega automáticamente a 192.168.x.x:8000.
const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8000`;

const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Inyecta el JWT en cada petición saliente
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Si el token expiró o es inválido, limpiamos sesión y mandamos a login
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401 && window.location.pathname !== '/login') {
            localStorage.removeItem('access_token');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

export default api;