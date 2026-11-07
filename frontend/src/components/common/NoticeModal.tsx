import './NoticeModal.css';

export type NoticeType = 'error' | 'warning' | 'success';

interface NoticeModalProps {
    type: NoticeType;
    title: string;
    message: string;
    onClose: () => void;
}

const NOTICE_STYLE: Record<NoticeType, { color: string; icon: string; iconClass: string }> = {
    error: { color: 'var(--ipn-maroon)', icon: 'fa-circle-exclamation', iconClass: 'error-icon-circle' },
    warning: { color: 'var(--warning-amber, #b45309)', icon: 'fa-triangle-exclamation', iconClass: 'warning-icon-circle' },
    success: { color: 'var(--escom-blue)', icon: 'fa-check', iconClass: 'success-icon-circle' },
};

export default function NoticeModal({ type, title, message, onClose }: NoticeModalProps) {
    const { color, icon, iconClass } = NOTICE_STYLE[type];

    return (
        <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content shadow-lg text-center">
                    <div className="modal-header-gradient" style={{ background: color }} />
                    <div className="modal-body p-5">
                        <div className={`${iconClass} animate__animated animate__bounceIn`}>
                            <i className={`fas ${icon} fa-3x`}></i>
                        </div>
                        <h4 className="fw-bold">{title}</h4>
                        <p className="text-muted mb-0">{message}</p>
                        <button type="button" className="btn w-100 mt-4 py-3 shadow-sm text-white" style={{ background: color }} onClick={onClose}>
                            Entendido
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
