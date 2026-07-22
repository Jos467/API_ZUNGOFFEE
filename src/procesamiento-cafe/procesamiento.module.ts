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
} from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsPositive } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class CreateProcesamientoDto {
  @Type(() => Number) @IsInt() loteOrigenId: number; // acepta 2 o "2" (BigInt llega como string)
  @IsInt() estadoDestinoId: number; // 4-6 tostado, 7 molido
  @IsNumber() @IsPositive() cantidadEntrada: number;
  @IsNumber() @IsPositive() cantidadSalida: number;
}

const TIPO_MOV_SALIDA_PROC = 3;
const TIPO_MOV_ENTRADA_PROC = 4;
const TIPO_MOV_AJUSTE_POSITIVO = 5;
const TIPO_MOV_AJUSTE_NEGATIVO = 6;
const TABLA_PROCESAMIENTO_ID = 4;
const ACCION_INSERT_ID = 1;
const ACCION_UPDATE_ID = 2;

// Solo se puede tostar pergamino_seco (3), y solo moler un tostado (4/5/6).
const TRANSICIONES_VALIDAS: Record<number, number[]> = {
  3: [4, 5, 6],
  4: [7],
  5: [7],
  6: [7],
};

@Injectable()
class ProcesamientoService {
  constructor(private prisma: PrismaService) {}

  async crear(dto: CreateProcesamientoDto, user: CurrentUserData) {
    if (!user.tenantId)
      throw new BadRequestException('super_admin no procesa café');

    const tx = this.prisma.getDb();
    {
      const [origen] = await tx.$queryRaw<
        {
          saldo: any;
          tenant_id: number;
          variedad_id: number | null;
          altura_id: number | null;
          estado_cafe_id: number;
          costo_unitario: any;
        }[]
      >`
        SELECT saldo, tenant_id, variedad_id, altura_id, estado_cafe_id, costo_unitario FROM lotes WHERE id = ${dto.loteOrigenId} FOR UPDATE`;

      if (!origen || origen.tenant_id !== user.tenantId) {
        throw new BadRequestException('Lote origen no existe en tu tenant');
      }
      if (Number(origen.saldo) < dto.cantidadEntrada) {
        throw new BadRequestException('Saldo insuficiente en el lote origen');
      }
      if (
        !TRANSICIONES_VALIDAS[origen.estado_cafe_id]?.includes(
          dto.estadoDestinoId,
        )
      ) {
        throw new BadRequestException(
          'Transición de estado no permitida para este lote',
        );
      }

      // Costo real de producción heredado: el costo unitario del origen se prorratea
      // por la cantidad consumida y se reparte entre la cantidad de salida -- las
      // unidades no son las mismas (ej. quintal de pergamino -> libra de tostado),
      // por eso no se puede copiar el costo_unitario tal cual.
      const costoOrigenConsumido = origen.costo_unitario
        ? Number(origen.costo_unitario) * dto.cantidadEntrada
        : null;
      const costoUnitarioDestino = costoOrigenConsumido
        ? costoOrigenConsumido / dto.cantidadSalida
        : null;

      const loteDestino = await tx.lotes.create({
        data: {
          tenant_id: user.tenantId,
          estado_cafe_id: dto.estadoDestinoId,
          lote_origen_id: dto.loteOrigenId,
          variedad_id: origen.variedad_id,
          altura_id: origen.altura_id,
          cantidad_inicial: dto.cantidadSalida,
          saldo: dto.cantidadSalida,
          costo_unitario: costoUnitarioDestino,
        },
      });

      await tx.lotes.update({
        where: { id: dto.loteOrigenId },
        data: { saldo: { decrement: dto.cantidadEntrada } },
      });

      const proceso = await tx.procesamiento_cafe.create({
        data: {
          tenant_id: user.tenantId,
          lote_origen_id: dto.loteOrigenId,
          lote_destino_id: loteDestino.id,
          cantidad_entrada: dto.cantidadEntrada,
          cantidad_salida: dto.cantidadSalida,
          usuario_id: user.usuarioId,
        },
      });

      await tx.inventario_movimientos.createMany({
        data: [
          {
            tenant_id: user.tenantId,
            lote_id: dto.loteOrigenId,
            tipo_movimiento_id: TIPO_MOV_SALIDA_PROC,
            cantidad: dto.cantidadEntrada,
            referencia_id: proceso.id,
            usuario_id: user.usuarioId,
          },
          {
            tenant_id: user.tenantId,
            lote_id: loteDestino.id,
            tipo_movimiento_id: TIPO_MOV_ENTRADA_PROC,
            cantidad: dto.cantidadSalida,
            referencia_id: proceso.id,
            usuario_id: user.usuarioId,
          },
        ],
      });

      await tx.bitacora.create({
        data: {
          tenant_id: user.tenantId,
          usuario_id: user.usuarioId,
          tabla_afectada_id: TABLA_PROCESAMIENTO_ID,
          registro_id: proceso.id,
          accion_id: ACCION_INSERT_ID,
        },
      });

      return { ...proceso, lote_destino: loteDestino };
    }
  }

  listar(user: CurrentUserData, skip = 0, take = 20) {
    return this.prisma.getDb().procesamiento_cafe.findMany({
      where: { tenant_id: user.tenantId! },
      orderBy: { fecha: 'desc' },
      skip,
      take,
    });
  }

  async anular(id: number, user: CurrentUserData) {
    if (!user.tenantId)
      throw new BadRequestException('super_admin no anula procesamientos');
    const db = this.prisma.getDb();

    const [proceso] = await db.$queryRaw<
      {
        id: number;
        tenant_id: number;
        anulado: boolean;
        lote_origen_id: bigint;
        lote_destino_id: bigint;
        cantidad_entrada: any;
      }[]
    >`
      SELECT id, tenant_id, anulado, lote_origen_id, lote_destino_id, cantidad_entrada FROM procesamiento_cafe WHERE id = ${id} FOR UPDATE`;

    if (!proceso || proceso.tenant_id !== user.tenantId) {
      throw new BadRequestException('Procesamiento no encontrado');
    }
    if (proceso.anulado)
      throw new BadRequestException('Este procesamiento ya fue anulado');

    const [loteDestino] = await db.$queryRaw<
      { saldo: any; cantidad_inicial: any }[]
    >`
      SELECT saldo, cantidad_inicial FROM lotes WHERE id = ${proceso.lote_destino_id} FOR UPDATE`;

    if (Number(loteDestino.saldo) !== Number(loteDestino.cantidad_inicial)) {
      throw new BadRequestException(
        'No se puede anular: el lote derivado ya tiene ventas o procesamientos posteriores',
      );
    }

    await db.lotes.update({
      where: { id: proceso.lote_origen_id },
      data: { saldo: { increment: Number(proceso.cantidad_entrada) } },
    });
    await db.lotes.update({
      where: { id: proceso.lote_destino_id },
      data: { saldo: 0 },
    });
    await db.procesamiento_cafe.update({
      where: { id },
      data: { anulado: true },
    });

    await db.inventario_movimientos.createMany({
      data: [
        {
          tenant_id: user.tenantId,
          lote_id: proceso.lote_origen_id,
          tipo_movimiento_id: TIPO_MOV_AJUSTE_POSITIVO,
          cantidad: Number(proceso.cantidad_entrada),
          referencia_id: proceso.id,
          usuario_id: user.usuarioId,
        },
        {
          tenant_id: user.tenantId,
          lote_id: proceso.lote_destino_id,
          tipo_movimiento_id: TIPO_MOV_AJUSTE_NEGATIVO,
          cantidad: Number(loteDestino.saldo),
          referencia_id: proceso.id,
          usuario_id: user.usuarioId,
        },
      ],
    });

    await db.bitacora.create({
      data: {
        tenant_id: user.tenantId,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_PROCESAMIENTO_ID,
        registro_id: proceso.id,
        accion_id: ACCION_UPDATE_ID,
      },
    });

    return { ok: true };
  }
}

@Controller('procesamiento')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class ProcesamientoController {
  constructor(private readonly service: ProcesamientoService) {}

  @Post()
  @Roles('admin_bodega', 'empleado')
  crear(
    @Body() dto: CreateProcesamientoDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.crear(dto, user);
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

  @Patch(':id/anular')
  @Roles('admin_bodega')
  anular(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.anular(id, user);
  }
}

@Module({
  controllers: [ProcesamientoController],
  providers: [ProcesamientoService],
})
export class ProcesamientoModule {}
