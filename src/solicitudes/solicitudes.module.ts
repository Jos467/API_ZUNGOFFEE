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
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsString, IsOptional, IsEmail } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class CreateSolicitudDto {
  @IsString() nombreBodega: string;
  @IsString() nombreContacto: string;
  @IsEmail() email: string;
  @IsString() telefono: string;
  @IsOptional() @IsString() mensaje?: string;
}

const ESTADO_SOLICITUD_PROCESADA = 2;
const ESTADO_SOLICITUD_RECHAZADA = 3;
const TIPO_NOTIFICACION_SOLICITUD_PENDIENTE = 5;
const TABLA_SOLICITUDES_ID = 11;
const ACCION_UPDATE_ID = 2;

@Injectable()
class SolicitudesService {
  constructor(private prisma: PrismaService) {}

  async crear(dto: CreateSolicitudDto) {
    const db = this.prisma.getDb();
    const solicitud = await db.solicitudes_registro.create({
      data: {
        nombre_bodega: dto.nombreBodega,
        nombre_contacto: dto.nombreContacto,
        email: dto.email,
        telefono: dto.telefono,
        mensaje: dto.mensaje,
      },
    });

    // tenant_id null + usuario_id null => solo la ven los super_admin (su
    // propio tenant_id tambien es null, ver NotificacionesService.misNotificaciones).
    await db.notificaciones.create({
      data: {
        tenant_id: null,
        usuario_id: null,
        tipo_id: TIPO_NOTIFICACION_SOLICITUD_PENDIENTE,
        titulo: 'Nueva solicitud pendiente',
        mensaje: `Tienes una solicitud pendiente de ${dto.nombreContacto} para ${dto.nombreBodega}.`,
      },
    });

    return solicitud;
  }

  listar() {
    return this.prisma.getDb().solicitudes_registro.findMany({
      orderBy: [{ estado_id: 'asc' }, { fecha_creacion: 'desc' }],
    });
  }

  async rechazar(id: number, user: CurrentUserData) {
    const db = this.prisma.getDb();
    const solicitud = await db.solicitudes_registro.findUnique({ where: { id } });
    if (!solicitud) throw new BadRequestException('Solicitud no encontrada');
    if (solicitud.estado_id === ESTADO_SOLICITUD_PROCESADA) {
      throw new BadRequestException(
        'Esta solicitud ya fue procesada (ya se creó un tenant a partir de ella) -- no se puede rechazar',
      );
    }
    if (solicitud.estado_id === ESTADO_SOLICITUD_RECHAZADA) {
      throw new BadRequestException('Esta solicitud ya estaba rechazada');
    }
    const actualizada = await db.solicitudes_registro.update({
      where: { id },
      data: { estado_id: ESTADO_SOLICITUD_RECHAZADA },
    });
    // tenant_id null -- esta accion no pertenece a ningun tenant, es a nivel
    // de plataforma (solo la ve el super_admin en GET /bitacora).
    await db.bitacora.create({
      data: {
        tenant_id: null,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_SOLICITUDES_ID,
        registro_id: id,
        accion_id: ACCION_UPDATE_ID,
      },
    });
    return actualizada;
  }
}

@Controller('solicitudes')
class SolicitudesController {
  constructor(private readonly service: SolicitudesService) {}

  // SIN AuthGuard a propósito -- la llama la landing pública sin login.
  // No replicar este patrón en ninguna otra ruta.
  @Post()
  crear(@Body() dto: CreateSolicitudDto) {
    return this.service.crear(dto);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  listar() {
    return this.service.listar();
  }

  @Patch(':id/rechazar')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  rechazar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.rechazar(id, user);
  }
}

@Module({
  controllers: [SolicitudesController],
  providers: [SolicitudesService],
})
export class SolicitudesModule {}
