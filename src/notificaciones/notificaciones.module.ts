import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  Injectable,
  Module,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsString, IsInt } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class RegistrarDispositivoDto {
  @IsString() token: string;
  @IsInt() plataformaId: number; // 1 = ios, 2 = android
}

@Injectable()
class NotificacionesService {
  constructor(private prisma: PrismaService) {}

  // Ruta estática -- antes de :id en el controller
  misNotificaciones(user: CurrentUserData, skip = 0, take = 50) {
    return this.prisma.getDb().notificaciones.findMany({
      where: {
        OR: [
          { usuario_id: user.usuarioId },
          { AND: [{ usuario_id: null }, { tenant_id: user.tenantId }] },
        ],
      },
      orderBy: { fecha_creacion: 'desc' },
      skip,
      take,
    });
  }

  marcarLeida(id: number, user: CurrentUserData) {
    // Mismo criterio de visibilidad que misNotificaciones(): propia, o del
    // tenant entero (usuario_id null). Nota: una notificacion de tenant
    // comparte un unico estado leida/no-leida -- si un usuario la marca,
    // queda marcada para todo el tenant (no hay estado de lectura por usuario
    // en el esquema actual).
    return this.prisma.getDb().notificaciones.updateMany({
      where: {
        id,
        OR: [
          { usuario_id: user.usuarioId },
          { AND: [{ usuario_id: null }, { tenant_id: user.tenantId }] },
        ],
      },
      data: { leida: true, fecha_leida: new Date() },
    });
  }

  registrarDispositivo(dto: RegistrarDispositivoDto, user: CurrentUserData) {
    return this.prisma.getDb().dispositivos_push.upsert({
      where: { token: dto.token },
      create: {
        usuario_id: user.usuarioId,
        token: dto.token,
        plataforma_id: dto.plataformaId,
      },
      update: { usuario_id: user.usuarioId, activo: true },
    });
  }
}

@Controller('notificaciones')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class NotificacionesController {
  constructor(private readonly service: NotificacionesService) {}

  @Get()
  listar(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
  ) {
    const take = Math.min(Number(pageSize) || 50, 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    return this.service.misNotificaciones(user, skip, take);
  }

  @Patch(':id/leida')
  marcarLeida(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.marcarLeida(id, user);
  }

  @Post('dispositivos')
  registrarDispositivo(
    @Body() dto: RegistrarDispositivoDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.registrarDispositivo(dto, user);
  }
}

@Module({
  controllers: [NotificacionesController],
  providers: [NotificacionesService],
})
export class NotificacionesModule {}
