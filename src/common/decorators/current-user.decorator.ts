import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserData {
  usuarioId: number;
  tenantId: number | null;
  authUid: string;
  nombre: string;
  rol: string;
}

// Uso en un controller: @CurrentUser() user: CurrentUserData
// Esto es lo único válido para saber "quién hace la petición" -- ver
// regla 4.4 del prompt original: nunca confiar en el body para identidad.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserData => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
