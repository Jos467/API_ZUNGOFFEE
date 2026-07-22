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
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  IsString,
  IsInt,
  IsEmail,
  IsOptional,
  IsBoolean,
  MinLength,
} from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { supabaseAdmin } from '../common/supabase-admin';

class CreateUsuarioDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsString() nombre: string;
  @IsOptional() @IsInt() rolId?: number; // ignorado si el creador es admin_bodega -- siempre se fuerza a empleado
  @IsOptional() @IsInt() tenantId?: number; // solo super_admin puede especificarlo
}

class ActualizarUsuarioDto {
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsBoolean() estado?: boolean;
  @IsOptional() @IsInt() rolId?: number;
}

const ROL_EMPLEADO = 3;

@Injectable()
class UsuariosService {
  constructor(private prisma: PrismaService) {}

  async crear(dto: CreateUsuarioDto, user: CurrentUserData) {
    const tenantId =
      user.rol === 'admin_bodega' ? user.tenantId : (dto.tenantId ?? null);
    const rolId =
      user.rol === 'admin_bodega' ? ROL_EMPLEADO : (dto.rolId ?? ROL_EMPLEADO);

    const { data, error } = await supabaseAdmin().auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new BadRequestException(
        error?.message ?? 'No se pudo crear el usuario en Supabase Auth',
      );
    }

    return this.prisma.getDb().usuarios.create({
      data: {
        tenant_id: tenantId,
        auth_uid: data.user.id,
        nombre: dto.nombre,
        rol_id: rolId,
      },
    });
  }

  listar(user: CurrentUserData, skip = 0, take = 20) {
    return this.prisma.getDb().usuarios.findMany({
      where: user.rol === 'super_admin' ? {} : { tenant_id: user.tenantId! },
      select: {
        id: true,
        nombre: true,
        estado: true,
        roles: { select: { nombre: true } },
      }, // nunca exponer auth_uid
      skip,
      take,
    });
  }

  async actualizar(
    id: number,
    dto: ActualizarUsuarioDto,
    user: CurrentUserData,
  ) {
    if (user.rol === 'admin_bodega') {
      const objetivo = await this.prisma
        .getDb()
        .usuarios.findUnique({ where: { id }, select: { tenant_id: true } });
      if (!objetivo || objetivo.tenant_id !== user.tenantId) {
        throw new ForbiddenException('Ese usuario no pertenece a tu tenant');
      }
      if (dto.rolId !== undefined && dto.rolId !== ROL_EMPLEADO) {
        throw new ForbiddenException(
          'admin_bodega solo puede asignar el rol de empleado',
        );
      }
    }
    return this.prisma.getDb().usuarios.update({
      where: { id },
      data: { nombre: dto.nombre, estado: dto.estado, rol_id: dto.rolId },
    });
  }
}

@Controller('usuarios')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class UsuariosController {
  constructor(private readonly service: UsuariosService) {}

  @Post()
  @Roles('super_admin', 'admin_bodega')
  crear(@Body() dto: CreateUsuarioDto, @CurrentUser() user: CurrentUserData) {
    return this.service.crear(dto, user);
  }

  @Get()
  @Roles('super_admin', 'admin_bodega')
  listar(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const take = Math.min(Number(pageSize) || 20, 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    return this.service.listar(user, skip, take);
  }

  @Patch(':id')
  @Roles('super_admin', 'admin_bodega')
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarUsuarioDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.actualizar(id, dto, user);
  }
}

@Module({ controllers: [UsuariosController], providers: [UsuariosService] })
export class UsuariosModule {}
