import { BadRequestException } from '@nestjs/common';
import type { CurrentUserData } from './decorators/current-user.decorator';

// super_admin no pertenece a ningun tenant (tenantId es null) -- para poder
// operar/depurar los modulos de bodega (proveedores, clientes, compras,
// ventas, lotes, procesamiento) tiene que indicar explicitamente sobre que
// tenant quiere actuar. admin_bodega/empleado ignoran cualquier tenantId que
// manden (se fuerza siempre el propio, mismo patron ya usado en usuarios.crear).
export function resolveTenantId(
  user: CurrentUserData,
  tenantIdParam?: number,
): number {
  if (user.rol !== 'super_admin') return user.tenantId!;
  if (!tenantIdParam) {
    throw new BadRequestException(
      'Como super_admin especifica ?tenantId=<id> (GET) o "tenantId" en el body (POST) para indicar sobre que bodega operar',
    );
  }
  return tenantIdParam;
}
