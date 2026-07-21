import { Controller, Get, Post, Patch, Body, Param, ParseIntPipe, UseGuards, Injectable, Module } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsString, IsOptional, IsInt } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class ClienteDto {
  @IsString() nombre: string;
  @IsOptional() @IsInt() tipoId?: number;
  @IsOptional() @IsString() lugar?: string;
  @IsOptional() @IsString() telefono?: string;
}

@Injectable()
class ClientesService {
  constructor(private prisma: PrismaService) {}

  crear(dto: ClienteDto, user: CurrentUserData) {
    return this.prisma.getDb().clientes.create({
      data: { tenant_id: user.tenantId!, nombre: dto.nombre, tipo_id: dto.tipoId, lugar: dto.lugar, telefono: dto.telefono },
    });
  }

  listar(user: CurrentUserData) {
    return this.prisma.getDb().clientes.findMany({ where: { tenant_id: user.tenantId! } });
  }

  actualizar(id: number, dto: Partial<ClienteDto>, user: CurrentUserData) {
    return this.prisma.getDb().clientes.updateMany({
      where: { id, tenant_id: user.tenantId! },
      data: { nombre: dto.nombre, tipo_id: dto.tipoId, lugar: dto.lugar, telefono: dto.telefono },
    });
  }
}

@Controller('clientes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class ClientesController {
  constructor(private readonly service: ClientesService) {}

  @Post() @Roles('admin_bodega', 'empleado')
  crear(@Body() dto: ClienteDto, @CurrentUser() user: CurrentUserData) { return this.service.crear(dto, user); }

  @Get() @Roles('admin_bodega', 'empleado')
  listar(@CurrentUser() user: CurrentUserData) { return this.service.listar(user); }

  @Patch(':id') @Roles('admin_bodega')
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<ClienteDto>, @CurrentUser() user: CurrentUserData) {
    return this.service.actualizar(id, dto, user);
  }
}

@Module({ controllers: [ClientesController], providers: [ClientesService] })
export class ClientesModule {}
