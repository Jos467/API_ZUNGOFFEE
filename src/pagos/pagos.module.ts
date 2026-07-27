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
import { estadoPagoCalculado } from '../common/estado-pago';

class RegistrarPagoDto {
  @IsInt() tenantId: number;
  @IsDateString() periodo: string; // '2026-08-01'
  @IsNumber() monto: number;
  @IsDateString() fechaVencimiento: string;
}

const ESTADO_PAGADO = 2;
const ESTADO_ACTIVO_TENANT = 1;
const ESTADO_SUSPENDIDO_TENANT = 2;
const TABLA_PAGOS_ID = 12;
const TABLA_TENANTS_ID = 10;
const ACCION_INSERT_ID = 1;
const ACCION_UPDATE_ID = 2;

// Estado calculado (no persistido) para lectura/UI -- no confundir con estado_pago_id,
// que solo cambia vía marcar-pagado.
function conEstadoCalculado<
  T extends { fecha_pago: Date | null; fecha_vencimiento: Date },
>(pagos: T[]) {
  return pagos.map((p) => ({
    ...p,
    estado_calculado: estadoPagoCalculado(p.fecha_pago, p.fecha_vencimiento),
  }));
}

@Injectable()
class PagosService {
  constructor(private prisma: PrismaService) {}

  async registrarCiclo(dto: RegistrarPagoDto, user: CurrentUserData) {
    const db = this.prisma.getDb();
    const pago = await db.pagos_tenant.create({
      data: {
        tenant_id: dto.tenantId,
        periodo: new Date(dto.periodo),
        monto: dto.monto,
        fecha_vencimiento: new Date(dto.fechaVencimiento),
        registrado_por: user.usuarioId,
      },
    });
    await db.bitacora.create({
      data: {
        tenant_id: dto.tenantId,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_PAGOS_ID,
        registro_id: pago.id,
        accion_id: ACCION_INSERT_ID,
      },
    });
    return pago;
  }

  async marcarPagado(id: number, user: CurrentUserData) {
    const db = this.prisma.getDb();
    const pago = await db.pagos_tenant.update({
      where: { id },
      data: { estado_pago_id: ESTADO_PAGADO, fecha_pago: new Date() },
    });
    await db.bitacora.create({
      data: {
        tenant_id: pago.tenant_id,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_PAGOS_ID,
        registro_id: id,
        accion_id: ACCION_UPDATE_ID,
      },
    });
    return pago;
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
  async cambiarEstadoTenant(
    tenantId: number,
    activar: boolean,
    user: CurrentUserData,
  ) {
    const db = this.prisma.getDb();
    const tenant = await db.tenants.update({
      where: { id: tenantId },
      data: {
        estado_id: activar ? ESTADO_ACTIVO_TENANT : ESTADO_SUSPENDIDO_TENANT,
      },
    });
    await db.bitacora.create({
      data: {
        tenant_id: tenantId,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_TENANTS_ID,
        registro_id: tenantId,
        accion_id: ACCION_UPDATE_ID,
      },
    });
    return tenant;
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
  marcarPagado(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.marcarPagado(id, user);
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
  suspender(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.cambiarEstadoTenant(tenantId, false, user);
  }

  @Patch('tenant/:tenantId/activar')
  @Roles('super_admin')
  activar(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.cambiarEstadoTenant(tenantId, true, user);
  }
}

@Module({ controllers: [PagosController], providers: [PagosService] })
export class PagosModule {}
