import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Injectable,
  Module,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsString } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class ActualizarPerfilDto {
  @IsString() nombre: string;
}

@Injectable()
class PerfilService {
  constructor(private prisma: PrismaService) {}

  obtener(user: CurrentUserData) {
    return this.prisma.getDb().usuarios.findUnique({
      where: { id: user.usuarioId },
      select: {
        id: true,
        nombre: true,
        estado: true,
        fecha_creacion: true,
        roles: { select: { nombre: true } },
        tenants: { select: { id: true, nombre: true } },
      }, // nunca exponer auth_uid
    });
  }

  actualizar(dto: ActualizarPerfilDto, user: CurrentUserData) {
    return this.prisma.getDb().usuarios.update({
      where: { id: user.usuarioId },
      data: { nombre: dto.nombre },
    });
  }
}

@Controller('perfil')
@UseGuards(AuthGuard('jwt'))
class PerfilController {
  constructor(private readonly service: PerfilService) {}

  @Get()
  obtener(@CurrentUser() user: CurrentUserData) {
    return this.service.obtener(user);
  }

  @Patch()
  actualizar(
    @Body() dto: ActualizarPerfilDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.actualizar(dto, user);
  }
}

@Module({ controllers: [PerfilController], providers: [PerfilService] })
export class PerfilModule {}
