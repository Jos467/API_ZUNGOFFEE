import { Controller, Get, Post, Body, UseGuards, Injectable, Module, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsString, IsInt, IsUUID } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class CreateUsuarioDto {
  @IsUUID() authUid: string; // se crea primero en Supabase Auth, esto solo lo enlaza
  @IsString() nombre: string;
  @IsInt() rolId: number; // admin_bodega solo puede asignar rolId = 3 (empleado)
}

@Injectable()
class UsuariosService {
  constructor(private prisma: PrismaService) {}

  crear(dto: CreateUsuarioDto, user: CurrentUserData) {
    if (user.rol === 'admin_bodega' && dto.rolId !== 3) {
      throw new ForbiddenException('admin_bodega solo puede crear empleados');
    }
    return this.prisma.getDb().usuarios.create({
      data: { tenant_id: user.tenantId, auth_uid: dto.authUid, nombre: dto.nombre, rol_id: dto.rolId },
    });
  }

  listar(user: CurrentUserData) {
    return this.prisma.getDb().usuarios.findMany({
      where: user.rol === 'super_admin' ? {} : { tenant_id: user.tenantId! },
      select: { id: true, nombre: true, estado: true, roles: { select: { nombre: true } } }, // nunca exponer auth_uid
    });
  }
}

@Controller('usuarios')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class UsuariosController {
  constructor(private readonly service: UsuariosService) {}

  @Post() @Roles('super_admin', 'admin_bodega')
  crear(@Body() dto: CreateUsuarioDto, @CurrentUser() user: CurrentUserData) { return this.service.crear(dto, user); }

  @Get() @Roles('super_admin', 'admin_bodega')
  listar(@CurrentUser() user: CurrentUserData) { return this.service.listar(user); }
}

@Module({ controllers: [UsuariosController], providers: [UsuariosService] })
export class UsuariosModule {}
