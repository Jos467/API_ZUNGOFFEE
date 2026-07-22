import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { Module } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsNumber } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class AjusteLoteDto {
  @IsNumber() cantidadAjuste: number; // positivo suma, negativo resta
}

const TIPO_MOV_AJUSTE_POSITIVO = 5;
const TIPO_MOV_AJUSTE_NEGATIVO = 6;

@Injectable()
class LotesService {
  constructor(private prisma: PrismaService) {}

  // Ruta estática -- va antes de :id en el controller
  existencias(user: CurrentUserData, skip = 0, take = 20) {
    return this.prisma.getDb().lotes.findMany({
      where: { tenant_id: user.tenantId!, saldo: { gt: 0 } },
      select: {
        id: true,
        saldo: true,
        cantidad_inicial: true,
        estados_cafe: { select: { nombre: true, unidad_medida_id: true } },
        variedades_cafe: { select: { nombre: true } },
        niveles_altura: { select: { nombre: true } },
      },
      skip,
      take,
    });
  }

  listar(user: CurrentUserData, skip = 0, take = 20) {
    return this.prisma
      .getDb()
      .lotes.findMany({ where: { tenant_id: user.tenantId! }, skip, take });
  }

  obtenerUno(id: number, user: CurrentUserData) {
    return this.prisma
      .getDb()
      .lotes.findFirst({ where: { id, tenant_id: user.tenantId! } });
  }

  async ajuste(id: number, dto: AjusteLoteDto, user: CurrentUserData) {
    if (!user.tenantId)
      throw new BadRequestException('super_admin no ajusta inventario');
    const db = this.prisma.getDb();

    const [lote] = await db.$queryRaw<{ saldo: any; tenant_id: number }[]>`
      SELECT saldo, tenant_id FROM lotes WHERE id = ${id} FOR UPDATE`;

    if (!lote || lote.tenant_id !== user.tenantId) {
      throw new BadRequestException(`Lote ${id} no existe en tu tenant`);
    }

    const nuevoSaldo = Number(lote.saldo) + dto.cantidadAjuste;
    if (nuevoSaldo < 0) {
      throw new BadRequestException(
        'El ajuste dejaría el saldo del lote en negativo',
      );
    }

    await db.lotes.update({ where: { id }, data: { saldo: nuevoSaldo } });
    await db.inventario_movimientos.create({
      data: {
        tenant_id: user.tenantId,
        lote_id: id,
        tipo_movimiento_id:
          dto.cantidadAjuste >= 0
            ? TIPO_MOV_AJUSTE_POSITIVO
            : TIPO_MOV_AJUSTE_NEGATIVO,
        cantidad: Math.abs(dto.cantidadAjuste),
        usuario_id: user.usuarioId,
      },
    });

    return { id, saldoAnterior: Number(lote.saldo), saldoNuevo: nuevoSaldo };
  }
}

@Controller('lotes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class LotesController {
  constructor(private readonly service: LotesService) {}

  @Get('existencias')
  @Roles('admin_bodega', 'empleado')
  existencias(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const take = Math.min(Number(pageSize) || 20, 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    return this.service.existencias(user, skip, take);
  }

  @Get()
  @Roles('admin_bodega', 'empleado')
  listar(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const take = Math.min(Number(pageSize) || 20, 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    return this.service.listar(user, skip, take);
  }

  @Get(':id')
  @Roles('admin_bodega', 'empleado')
  obtenerUno(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.obtenerUno(id, user);
  }

  @Post(':id/ajuste')
  @Roles('admin_bodega')
  ajuste(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AjusteLoteDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.ajuste(id, dto, user);
  }
}

@Module({ controllers: [LotesController], providers: [LotesService] })
export class LotesModule {}
