import { Controller, Get, Param, ParseIntPipe, UseGuards, Injectable } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
class LotesService {
  constructor(private prisma: PrismaService) {}

  existencias(user: CurrentUserData) {
    // Ruta estática -- va antes de :id en el controller
    return this.prisma.lotes.findMany({
      where: { tenant_id: user.tenantId!, saldo: { gt: 0 } },
      select: {
        id: true, saldo: true, cantidad_inicial: true,
        estados_cafe: { select: { nombre: true, unidad_medida_id: true } },
        variedades_cafe: { select: { nombre: true } },
        niveles_altura: { select: { nombre: true } },
      },
    });
  }

  listar(user: CurrentUserData) {
    return this.prisma.lotes.findMany({ where: { tenant_id: user.tenantId! } });
  }

  obtenerUno(id: number, user: CurrentUserData) {
    return this.prisma.lotes.findFirst({ where: { id, tenant_id: user.tenantId! } });
  }
}

@Controller('lotes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class LotesController {
  constructor(private readonly service: LotesService) {}

  @Get('existencias')
  @Roles('admin_bodega', 'empleado')
  existencias(@CurrentUser() user: CurrentUserData) {
    return this.service.existencias(user);
  }

  @Get()
  @Roles('admin_bodega', 'empleado')
  listar(@CurrentUser() user: CurrentUserData) {
    return this.service.listar(user);
  }

  @Get(':id')
  @Roles('admin_bodega', 'empleado')
  obtenerUno(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserData) {
    return this.service.obtenerUno(id, user);
  }
}

@Module({ controllers: [LotesController], providers: [LotesService] })
export class LotesModule {}
