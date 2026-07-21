import { Controller, Get, Post, Body, UseGuards, Injectable, Module } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsInt, IsNumber, IsPositive } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class CreateProcesamientoDto {
  @IsInt() loteOrigenId: number;
  @IsInt() estadoDestinoId: number; // 4-6 tostado, 7 molido
  @IsNumber() @IsPositive() cantidadEntrada: number;
  @IsNumber() @IsPositive() cantidadSalida: number;
}

const TIPO_MOV_SALIDA_PROC = 3;
const TIPO_MOV_ENTRADA_PROC = 4;

@Injectable()
class ProcesamientoService {
  constructor(private prisma: PrismaService) {}

  async crear(dto: CreateProcesamientoDto, user: CurrentUserData) {
    if (!user.tenantId) throw new BadRequestException('super_admin no procesa café');

    return this.prisma.$transaction(async (tx) => {
      const [origen] = await tx.$queryRaw<{ saldo: any; tenant_id: number; variedad_id: number | null; altura_id: number | null }[]>`
        SELECT saldo, tenant_id, variedad_id, altura_id FROM lotes WHERE id = ${dto.loteOrigenId} FOR UPDATE`;

      if (!origen || origen.tenant_id !== user.tenantId) {
        throw new BadRequestException('Lote origen no existe en tu tenant');
      }
      if (Number(origen.saldo) < dto.cantidadEntrada) {
        throw new BadRequestException('Saldo insuficiente en el lote origen');
      }

      const loteDestino = await tx.lotes.create({
        data: {
          tenant_id: user.tenantId!,
          estado_cafe_id: dto.estadoDestinoId,
          lote_origen_id: dto.loteOrigenId,
          variedad_id: origen.variedad_id,
          altura_id: origen.altura_id,
          cantidad_inicial: dto.cantidadSalida,
          saldo: dto.cantidadSalida,
        },
      });

      await tx.lotes.update({
        where: { id: dto.loteOrigenId },
        data: { saldo: { decrement: dto.cantidadEntrada } },
      });

      const proceso = await tx.procesamiento_cafe.create({
        data: {
          tenant_id: user.tenantId!,
          lote_origen_id: dto.loteOrigenId,
          lote_destino_id: loteDestino.id,
          cantidad_entrada: dto.cantidadEntrada,
          cantidad_salida: dto.cantidadSalida,
          usuario_id: user.usuarioId,
        },
      });

      await tx.inventario_movimientos.createMany({
        data: [
          { tenant_id: user.tenantId!, lote_id: dto.loteOrigenId, tipo_movimiento_id: TIPO_MOV_SALIDA_PROC, cantidad: dto.cantidadEntrada, referencia_id: proceso.id, usuario_id: user.usuarioId },
          { tenant_id: user.tenantId!, lote_id: loteDestino.id, tipo_movimiento_id: TIPO_MOV_ENTRADA_PROC, cantidad: dto.cantidadSalida, referencia_id: proceso.id, usuario_id: user.usuarioId },
        ],
      });

      return { proceso, loteDestino };
    });
  }

  listar(user: CurrentUserData) {
    return this.prisma.procesamiento_cafe.findMany({ where: { tenant_id: user.tenantId! } });
  }
}

@Controller('procesamiento')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class ProcesamientoController {
  constructor(private readonly service: ProcesamientoService) {}

  @Post()
  @Roles('admin_bodega', 'empleado')
  crear(@Body() dto: CreateProcesamientoDto, @CurrentUser() user: CurrentUserData) {
    return this.service.crear(dto, user);
  }

  @Get()
  @Roles('admin_bodega', 'empleado')
  listar(@CurrentUser() user: CurrentUserData) {
    return this.service.listar(user);
  }
}

@Module({ controllers: [ProcesamientoController], providers: [ProcesamientoService] })
export class ProcesamientoModule {}
