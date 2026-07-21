import { Controller, Get, Query, UseGuards, Injectable, Module } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
class BitacoraService {
  constructor(private prisma: PrismaService) {}

  listar(user: CurrentUserData, page: string, pageSize: string) {
    const take = Math.min(Number(pageSize) || 50, 200);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    return this.prisma.getDb().bitacora.findMany({
      where: user.rol === 'super_admin' ? {} : { tenant_id: user.tenantId! },
      include: {
        usuarios: { select: { id: true, nombre: true } },
        tablas_sistema: { select: { nombre: true } },
        acciones_bitacora: { select: { nombre: true } },
      },
      orderBy: { fecha: 'desc' },
      skip, take,
    });
  }
}

@Controller('bitacora')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class BitacoraController {
  constructor(private readonly service: BitacoraService) {}

  @Get()
  @Roles('super_admin', 'admin_bodega')
  listar(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
  ) {
    return this.service.listar(user, page, pageSize);
  }
}

@Module({ controllers: [BitacoraController], providers: [BitacoraService] })
export class BitacoraModule {}
