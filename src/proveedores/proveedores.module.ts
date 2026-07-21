import { Controller, Get, Post, Patch, Body, Param, ParseIntPipe, UseGuards, Injectable, Module } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsString, IsOptional, IsIn, IsInt } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class ProveedorDto {
  @IsString() nombre: string;
  @IsOptional() @IsIn(['M', 'F']) sexo?: string;
  @IsOptional() @IsString() lugar?: string;
  @IsOptional() @IsString() finca?: string;
  @IsOptional() @IsInt() tipoId?: number;
  @IsOptional() @IsString() telefono?: string;
}

@Injectable()
class ProveedoresService {
  constructor(private prisma: PrismaService) {}

  crear(dto: ProveedorDto, user: CurrentUserData) {
    return this.prisma.getDb().proveedores.create({
      data: { tenant_id: user.tenantId!, nombre: dto.nombre, sexo: dto.sexo, lugar: dto.lugar, finca: dto.finca, tipo_id: dto.tipoId, telefono: dto.telefono },
    });
  }

  listar(user: CurrentUserData) {
    return this.prisma.getDb().proveedores.findMany({ where: { tenant_id: user.tenantId! } });
  }

  actualizar(id: number, dto: Partial<ProveedorDto>, user: CurrentUserData) {
    return this.prisma.getDb().proveedores.updateMany({
      where: { id, tenant_id: user.tenantId! },
      data: { nombre: dto.nombre, sexo: dto.sexo, lugar: dto.lugar, finca: dto.finca, tipo_id: dto.tipoId, telefono: dto.telefono },
    });
  }
}

@Controller('proveedores')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class ProveedoresController {
  constructor(private readonly service: ProveedoresService) {}

  @Post() @Roles('admin_bodega', 'empleado')
  crear(@Body() dto: ProveedorDto, @CurrentUser() user: CurrentUserData) { return this.service.crear(dto, user); }

  @Get() @Roles('admin_bodega', 'empleado')
  listar(@CurrentUser() user: CurrentUserData) { return this.service.listar(user); }

  @Patch(':id') @Roles('admin_bodega')
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<ProveedorDto>, @CurrentUser() user: CurrentUserData) {
    return this.service.actualizar(id, dto, user);
  }
}

@Module({ controllers: [ProveedoresController], providers: [ProveedoresService] })
export class ProveedoresModule {}
