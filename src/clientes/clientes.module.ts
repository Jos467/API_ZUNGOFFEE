import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Injectable,
  Module,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsString, IsOptional, IsInt, IsBoolean } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTenantId } from '../common/resolve-tenant';

class ClienteDto {
  @IsString() nombre: string;
  @IsOptional() @IsInt() tipoId?: number;
  @IsOptional() @IsString() lugar?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsBoolean() estado?: boolean;
  @IsOptional() @IsInt() tenantId?: number; // solo super_admin -- ver resolveTenantId
}

const TABLA_CLIENTES_ID = 8;
const ACCION_INSERT_ID = 1;
const ACCION_UPDATE_ID = 2;

@Injectable()
class ClientesService {
  constructor(private prisma: PrismaService) {}

  async crear(dto: ClienteDto, user: CurrentUserData) {
    const tenantId = resolveTenantId(user, dto.tenantId);
    const db = this.prisma.getDb();
    const cliente = await db.clientes.create({
      data: {
        tenant_id: tenantId,
        nombre: dto.nombre,
        tipo_id: dto.tipoId,
        lugar: dto.lugar,
        telefono: dto.telefono,
      },
    });
    await db.bitacora.create({
      data: {
        tenant_id: tenantId,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_CLIENTES_ID,
        registro_id: cliente.id,
        accion_id: ACCION_INSERT_ID,
      },
    });
    return cliente;
  }

  listar(user: CurrentUserData, tenantIdParam?: number) {
    return this.prisma.getDb().clientes.findMany({
      where: { tenant_id: resolveTenantId(user, tenantIdParam) },
    });
  }

  async actualizar(
    id: number,
    dto: Partial<ClienteDto>,
    user: CurrentUserData,
  ) {
    const db = this.prisma.getDb();
    const resultado = await db.clientes.updateMany({
      where:
        user.rol === 'super_admin'
          ? { id }
          : { id, tenant_id: user.tenantId! },
      data: {
        nombre: dto.nombre,
        tipo_id: dto.tipoId,
        lugar: dto.lugar,
        telefono: dto.telefono,
        estado: dto.estado,
      },
    });
    if (resultado.count > 0) {
      const actualizado = await db.clientes.findUnique({
        where: { id },
        select: { tenant_id: true },
      });
      await db.bitacora.create({
        data: {
          tenant_id: actualizado!.tenant_id,
          usuario_id: user.usuarioId,
          tabla_afectada_id: TABLA_CLIENTES_ID,
          registro_id: id,
          accion_id: ACCION_UPDATE_ID,
        },
      });
    }
    return resultado;
  }
}

@Controller('clientes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class ClientesController {
  constructor(private readonly service: ClientesService) {}

  @Post()
  @Roles('admin_bodega', 'empleado', 'super_admin')
  crear(@Body() dto: ClienteDto, @CurrentUser() user: CurrentUserData) {
    return this.service.crear(dto, user);
  }

  @Get()
  @Roles('admin_bodega', 'empleado', 'super_admin')
  listar(
    @CurrentUser() user: CurrentUserData,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.listar(user, tenantId ? Number(tenantId) : undefined);
  }

  @Patch(':id')
  @Roles('admin_bodega', 'super_admin')
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<ClienteDto>,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.actualizar(id, dto, user);
  }
}

@Module({ controllers: [ClientesController], providers: [ClientesService] })
export class ClientesModule {}
