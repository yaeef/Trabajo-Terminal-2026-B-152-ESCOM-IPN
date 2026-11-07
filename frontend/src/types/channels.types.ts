// Corresponden a los schemas Pydantic en backend/app/schemas/user.py
// usados por backend/app/api/routes/channels.py.

export interface SecondaryEmailRequestPayload {
    correo_nuevo: string;
}

export interface ConfirmSecondaryEmailPayload {
    token: string;
}

export interface TelegramLinkCodeResponse {
    deep_link: string;
    expira_en_segundos: number;
}
