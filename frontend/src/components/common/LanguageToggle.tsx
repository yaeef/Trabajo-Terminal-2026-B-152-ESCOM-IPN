import { setLang, t, useLang } from '../../i18n';

/** Botón ES/EN; muestra el idioma al que se cambia (mismo estilo que el de tema). */
export default function LanguageToggle() {
    const lang = useLang();
    const siguiente = lang === 'es' ? 'en' : 'es';
    return (
        <button
            type="button"
            className="theme-toggle lang-toggle"
            onClick={() => setLang(siguiente)}
            title={t('Switch to English', 'Cambiar a español')}
            aria-label={t('Cambiar idioma', 'Change language')}
            lang={siguiente}
        >
            {siguiente.toUpperCase()}
        </button>
    );
}
