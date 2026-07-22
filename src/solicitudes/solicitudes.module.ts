import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Injectable,
  Module,
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
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() mensaje?: string;
}

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
}

@Module({
  controllers: [SolicitudesController],
  providers: [SolicitudesService],
})
export class SolicitudesModule {}
