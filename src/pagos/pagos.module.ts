import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Injectable,
  Module,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsInt, IsNumber, IsDateString } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class RegistrarPagoDto {
  @IsInt() tenantId: number;
  @IsDateString() periodo: string; // '2026-08-01'
  @IsNumber() monto: number;
  @IsDateString() fechaVencimiento: string;
}

const ESTADO_PAGADO = 2;
const ESTADO_ACTIVO_TENANT = 1;
const ESTADO_SUSPENDIDO_TENANT = 2;

// Estado calculado (no persistido) para lectura/UI -- no confundir con estado_pago_id,
// que solo cambia vía marcar-pagado.
function conEstadoCalculado<
  T extends { fecha_pago: Date | null; fecha_vencimiento: Date },
>(pagos: T[]) {
  const hoy = new Date();
  return pagos.map((p) => ({
    ...p,
    estado_calculado: p.fecha_pago
      ? 'pagado'
      : new Date(p.fecha_vencimiento) < hoy
        ? 'vencido'
        : 'pendiente',
  }));
}

@Injectable()
class PagosService {
  constructor(private prisma: PrismaService) {}

  registrarCiclo(dto: RegistrarPagoDto, user: CurrentUserData) {
    return this.prisma.getDb().pagos_tenant.create({
      data: {
        tenant_id: dto.tenantId,
        periodo: new Date(dto.periodo),
        monto: dto.monto,
        fecha_vencimiento: new Date(dto.fechaVencimiento),
        registrado_por: user.usuarioId,
      },
    });
  }

  async marcarPagado(id: number) {
    return this.prisma.getDb().pagos_tenant.update({
      where: { id },
      data: { estado_pago_id: ESTADO_PAGADO, fecha_pago: new Date() },
    });
  }

  async listarPorTenant(tenantId: number, user: CurrentUserData) {
    if (user.rol !== 'super_admin' && tenantId !== user.tenantId) {
      throw new ForbiddenException('No puedes ver los pagos de otro tenant');
    }
    const pagos = await this.prisma.getDb().pagos_tenant.findMany({
      where: { tenant_id: tenantId },
      orderBy: { periodo: 'desc' },
    });
    return conEstadoCalculado(pagos);
  }

  // Atajo directo: suspende/activa sin tener que ir a un módulo de tenants aparte
  cambiarEstadoTenant(tenantId: number, activar: boolean) {
    return this.prisma.getDb().tenants.update({
      where: { id: tenantId },
      data: {
        estado_id: activar ? ESTADO_ACTIVO_TENANT : ESTADO_SUSPENDIDO_TENANT,
      },
    });
  }

  async resumen() {
    const db = this.prisma.getDb();
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const [
      tenantsActivos,
      tenantsSuspendidos,
      ingresosMesActual,
      ingresosTotales,
    ] = await Promise.all([
      db.tenants.count({ where: { estado_id: ESTADO_ACTIVO_TENANT } }),
      db.tenants.count({ where: { estado_id: ESTADO_SUSPENDIDO_TENANT } }),
      db.pagos_tenant.aggregate({
        _sum: { monto: true },
        where: { fecha_pago: { gte: inicioMes } },
      }),
      db.pagos_tenant.aggregate({
        _sum: { monto: true },
        where: { fecha_pago: { not: null } },
      }),
    ]);

    return {
      tenantsActivos,
      tenantsSuspendidos,
      ingresosMesActual: ingresosMesActual._sum.monto ?? 0,
      ingresosTotales: ingresosTotales._sum.monto ?? 0,
    };
  }
}

@Controller('pagos')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class PagosController {
  constructor(private readonly service: PagosService) {}

  @Get('resumen')
  @Roles('super_admin')
  resumen() {
    return this.service.resumen();
  }

  @Post()
  @Roles('super_admin')
  registrar(
    @Body() dto: RegistrarPagoDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.registrarCiclo(dto, user);
  }

  @Patch(':id/marcar-pagado')
  @Roles('super_admin')
  marcarPagado(@Param('id', ParseIntPipe) id: number) {
    return this.service.marcarPagado(id);
  }

  @Get('tenant/:tenantId')
  @Roles('super_admin', 'admin_bodega')
  listarPorTenant(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.listarPorTenant(tenantId, user);
  }

  @Patch('tenant/:tenantId/suspender')
  @Roles('super_admin')
  suspender(@Param('tenantId', ParseIntPipe) tenantId: number) {
    return this.service.cambiarEstadoTenant(tenantId, false);
  }

  @Patch('tenant/:tenantId/activar')
  @Roles('super_admin')
  activar(@Param('tenantId', ParseIntPipe) tenantId: number) {
    return this.service.cambiarEstadoTenant(tenantId, true);
  }
}

@Module({ controllers: [PagosController], providers: [PagosService] })
export class PagosModule {}
