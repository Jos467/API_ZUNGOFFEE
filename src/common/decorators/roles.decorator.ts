import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
// Uso: @Roles('super_admin', 'admin_bodega')
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
