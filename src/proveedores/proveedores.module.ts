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
import { IsString, IsOptional, IsIn, IsInt, IsBoolean } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTenantId } from '../common/resolve-tenant';

class ProveedorDto {
  @IsString() nombre: string;
  @IsOptional() @IsIn(['M', 'F']) sexo?: string;
  @IsOptional() @IsString() lugar?: string;
  @IsOptional() @IsString() finca?: string;
  @IsOptional() @IsInt() tipoId?: number;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsBoolean() estado?: boolean;
  @IsOptional() @IsInt() tenantId?: number; // solo super_admin -- ver resolveTenantId
}

const TABLA_PROVEEDORES_ID = 7;
const ACCION_INSERT_ID = 1;
const ACCION_UPDATE_ID = 2;

@Injectable()
class ProveedoresService {
  constructor(private prisma: PrismaService) {}

  async crear(dto: ProveedorDto, user: CurrentUserData) {
    const tenantId = resolveTenantId(user, dto.tenantId);
    const db = this.prisma.getDb();
    const proveedor = await db.proveedores.create({
      data: {
        tenant_id: tenantId,
        nombre: dto.nombre,
        sexo: dto.sexo,
        lugar: dto.lugar,
        finca: dto.finca,
        tipo_id: dto.tipoId,
        telefono: dto.telefono,
      },
    });
    await db.bitacora.create({
      data: {
        tenant_id: tenantId,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_PROVEEDORES_ID,
        registro_id: proveedor.id,
        accion_id: ACCION_INSERT_ID,
      },
    });
    return proveedor;
  }

  listar(user: CurrentUserData, tenantIdParam?: number) {
    return this.prisma.getDb().proveedores.findMany({
      where: { tenant_id: resolveTenantId(user, tenantIdParam) },
    });
  }

  async actualizar(
    id: number,
    dto: Partial<ProveedorDto>,
    user: CurrentUserData,
  ) {
    const db = this.prisma.getDb();
    // super_admin puede editar cualquier proveedor (para depurar); el resto
    // solo los de su propio tenant.
    const resultado = await db.proveedores.updateMany({
      where:
        user.rol === 'super_admin'
          ? { id }
          : { id, tenant_id: user.tenantId! },
      data: {
        nombre: dto.nombre,
        sexo: dto.sexo,
        lugar: dto.lugar,
        finca: dto.finca,
        tipo_id: dto.tipoId,
        telefono: dto.telefono,
        estado: dto.estado,
      },
    });
    if (resultado.count > 0) {
      const actualizado = await db.proveedores.findUnique({
        where: { id },
        select: { tenant_id: true },
      });
      await db.bitacora.create({
        data: {
          tenant_id: actualizado!.tenant_id,
          usuario_id: user.usuarioId,
          tabla_afectada_id: TABLA_PROVEEDORES_ID,
          registro_id: id,
          accion_id: ACCION_UPDATE_ID,
        },
      });
    }
    return resultado;
  }
}

@Controller('proveedores')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class ProveedoresController {
  constructor(private readonly service: ProveedoresService) {}

  @Post()
  @Roles('admin_bodega', 'empleado', 'super_admin')
  crear(@Body() dto: ProveedorDto, @CurrentUser() user: CurrentUserData) {
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
    @Body() dto: Partial<ProveedorDto>,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.actualizar(id, dto, user);
  }
}

@Module({
  controllers: [ProveedoresController],
  providers: [ProveedoresService],
})
export class ProveedoresModule {}
