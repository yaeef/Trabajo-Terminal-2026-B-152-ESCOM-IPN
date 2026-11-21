import { REGLAS_CONTRASENA } from '../../utils/password';
import { t } from '../../i18n';
import './RequisitosContrasena.css';

interface Props {
    password: string;
    /** Si se pasa, agrega la regla «Las contraseñas coinciden». */
    confirmacion?: string;
}

/** Lista de requisitos que se va marcando mientras se escribe la contraseña. */
export default function RequisitosContrasena({ password, confirmacion }: Props) {
    const reglas = REGLAS_CONTRASENA.map((r) => ({ clave: r.clave, texto: r.texto(), ok: r.cumple(password) }));
    if (confirmacion !== undefined) {
        reglas.push({
            clave: 'coinciden',
            texto: t('Las dos contraseñas coinciden', 'Both passwords match'),
            ok: password.length > 0 && password === confirmacion,
        });
    }
    return (
        <ul className="requisitos-contrasena" aria-label={t('Requisitos de la contraseña', 'Password requirements')}>
            {reglas.map((r) => (
                <li key={r.clave} className={r.ok ? 'is-ok' : ''}>
                    <i className={`fas ${r.ok ? 'fa-circle-check' : 'fa-circle'}`} aria-hidden="true" />
                    <span>{r.texto}</span>
                    <span className="visually-hidden">{r.ok ? t(' (cumplido)', ' (met)') : t(' (pendiente)', ' (pending)')}</span>
                </li>
            ))}
        </ul>
    );
}
