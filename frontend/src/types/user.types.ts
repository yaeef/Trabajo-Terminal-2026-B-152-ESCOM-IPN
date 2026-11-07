// Corresponden a los schemas Pydantic UserUpdate y ChangePasswordRequest
// en backend/app/schemas/user.py.

export interface UserUpdatePayload {
    nombre?: string;
    paterno?: string;
    materno?: string;
}

export interface ChangePasswordPayload {
    password_actual: string;
    nueva_password: string;
    confirmar_password: string;
}
