import { Controller, Get, Post, Patch, Body, Param, ParseIntPipe, UseGuards, Injectable, Module } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsInt, IsNumber, IsDateString } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class RegistrarPagoDto {
  @IsInt() tenantId: number;
  @IsDateString() periodo: string;       // '2026-08-01'
  @IsNumber() monto: number;
  @IsDateString() fechaVencimiento: string;
}

const ESTADO_PAGADO = 2;
const ESTADO_ACTIVO_TENANT = 1;
const ESTADO_SUSPENDIDO_TENANT = 2;

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

  listarPorTenant(tenantId: number) {
    return this.prisma.getDb().pagos_tenant.findMany({
      where: { tenant_id: tenantId },
      orderBy: { periodo: 'desc' },
    });
  }

  // Atajo directo: suspende/activa sin tener que ir a un módulo de tenants aparte
  cambiarEstadoTenant(tenantId: number, activar: boolean) {
    return this.prisma.getDb().tenants.update({
      where: { id: tenantId },
      data: { estado_id: activar ? ESTADO_ACTIVO_TENANT : ESTADO_SUSPENDIDO_TENANT },
    });
  }
}

@Controller('pagos')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
class PagosController {
  constructor(private readonly service: PagosService) {}

  @Post()
  registrar(@Body() dto: RegistrarPagoDto, @CurrentUser() user: CurrentUserData) {
    return this.service.registrarCiclo(dto, user);
  }

  @Patch(':id/marcar-pagado')
  marcarPagado(@Param('id', ParseIntPipe) id: number) {
    return this.service.marcarPagado(id);
  }

  @Get('tenant/:tenantId')
  listarPorTenant(@Param('tenantId', ParseIntPipe) tenantId: number) {
    return this.service.listarPorTenant(tenantId);
  }

  @Patch('tenant/:tenantId/suspender')
  suspender(@Param('tenantId', ParseIntPipe) tenantId: number) {
    return this.service.cambiarEstadoTenant(tenantId, false);
  }

  @Patch('tenant/:tenantId/activar')
  activar(@Param('tenantId', ParseIntPipe) tenantId: number) {
    return this.service.cambiarEstadoTenant(tenantId, true);
  }
}

@Module({ controllers: [PagosController], providers: [PagosService] })
export class PagosModule {}
