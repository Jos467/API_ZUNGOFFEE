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

@Injectable()
class SolicitudesService {
  constructor(private prisma: PrismaService) {}

  crear(dto: CreateSolicitudDto) {
    return this.prisma.getDb().solicitudes_registro.create({
      data: {
        nombre_bodega: dto.nombreBodega,
        nombre_contacto: dto.nombreContacto,
        email: dto.email,
        telefono: dto.telefono,
        mensaje: dto.mensaje,
      },
    });
  }

  listar() {
    return this.prisma.getDb().solicitudes_registro.findMany({
      orderBy: [{ estado_id: 'asc' }, { fecha_creacion: 'desc' }],
    });
  }

  async rechazar(id: number) {
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
    return db.solicitudes_registro.update({
      where: { id },
      data: { estado_id: ESTADO_SOLICITUD_RECHAZADA },
    });
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
  rechazar(@Param('id', ParseIntPipe) id: number) {
    return this.service.rechazar(id);
  }
}

@Module({
  controllers: [SolicitudesController],
  providers: [SolicitudesService],
})
export class SolicitudesModule {}
