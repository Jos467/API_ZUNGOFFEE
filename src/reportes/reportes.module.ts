import { Controller, Get, Query, UseGuards, Injectable, Module } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
class ReportesService {
  constructor(private prisma: PrismaService) {}

  ventasPorRango(desde: string, hasta: string, user: CurrentUserData) {
    return this.prisma.ventas.findMany({
      where: {
        tenant_id: user.tenantId!,
        fecha: { gte: new Date(desde), lte: new Date(hasta) },
      },
      include: { ventas_detalle: true },
    });
  }

  comprasPorRango(desde: string, hasta: string, user: CurrentUserData) {
    return this.prisma.compras.findMany({
      where: { tenant_id: user.tenantId!, fecha: { gte: new Date(desde), lte: new Date(hasta) } },
      include: { compras_detalle: true },
    });
  }

  inventarioActual(user: CurrentUserData) {
    return this.prisma.lotes.findMany({
      where: { tenant_id: user.tenantId!, saldo: { gt: 0 } },
      include: { estados_cafe: true, variedades_cafe: true, niveles_altura: true },
    });
  }
}

@Controller('reportes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class ReportesController {
  constructor(private readonly service: ReportesService) {}

  @Get('ventas')
  @Roles('admin_bodega', 'super_admin')
  ventas(@Query('desde') desde: string, @Query('hasta') hasta: string, @CurrentUser() user: CurrentUserData) {
    return this.service.ventasPorRango(desde, hasta, user);
  }

  @Get('compras')
  @Roles('admin_bodega', 'super_admin')
  compras(@Query('desde') desde: string, @Query('hasta') hasta: string, @CurrentUser() user: CurrentUserData) {
    return this.service.comprasPorRango(desde, hasta, user);
  }

  @Get('inventario')
  @Roles('admin_bodega', 'super_admin')
  inventario(@CurrentUser() user: CurrentUserData) {
    return this.service.inventarioActual(user);
  }
}

@Module({ controllers: [ReportesController], providers: [ReportesService] })
export class ReportesModule {}
