import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger('RolesGuard');

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles) return true; // sin @Roles() -- cualquier autenticado entra

    const request = context.switchToHttp().getRequest();
    const { user } = request;
    const permitido = !!user && requiredRoles.includes(user.rol);

    // Log temporal de diagnostico (reporte de Ramos, 403 en 3 rutas puntuales)
    // -- deja rastro en los logs de Render de exactamente que rol/tenant tenia
    // el usuario cuando el guard rechazo, en vez de tener que reproducirlo a
    // ciegas. Se puede quitar despues de confirmar la causa.
    if (!permitido) {
      this.logger.warn(
        `403 -- ${request.method} ${request.url} | requiredRoles=[${requiredRoles.join(',')}] | user=${
          user
            ? `usuarioId=${user.usuarioId} rol=${user.rol} tenantId=${user.tenantId}`
            : 'NO_USER (AuthGuard no seteo request.user)'
        }`,
      );
    }

    return permitido;
  }
}
