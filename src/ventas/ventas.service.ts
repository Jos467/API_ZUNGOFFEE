import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVentaDto } from './dto/create-venta.dto';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';

const TABLA_VENTAS_ID = 5;
const ACCION_INSERT_ID = 1;
const ACCION_UPDATE_ID = 2;
const TIPO_MOV_SALIDA_VENTA = 2;
const TIPO_MOV_AJUSTE_POSITIVO = 5;

@Injectable()
export class VentasService {
  constructor(private prisma: PrismaService) {}

  async crear(dto: CreateVentaDto, user: CurrentUserData) {
    if (!user.tenantId)
      throw new ForbiddenException('super_admin no registra ventas');
    const db = this.prisma.getDb();

    const venta = await db.ventas.create({
      data: {
        tenant_id: user.tenantId,
        cliente_id: dto.clienteId,
        usuario_id: user.usuarioId,
        metodo_pago_id: dto.metodoPagoId,
        total: dto.lineas.reduce(
          (s, l) => s + l.cantidad * l.precioUnitario,
          0,
        ),
      },
    });

    for (const linea of dto.lineas) {
      const [lote] = await db.$queryRaw<{ saldo: any; tenant_id: number }[]>`
        SELECT saldo, tenant_id FROM lotes WHERE id = ${linea.loteId} FOR UPDATE`;

      if (!lote || lote.tenant_id !== user.tenantId) {
        throw new BadRequestException(
          `Lote ${linea.loteId} no existe en tu tenant`,
        );
      }
      if (Number(lote.saldo) < linea.cantidad) {
        throw new BadRequestException(
          `Saldo insuficiente en lote ${linea.loteId}`,
        );
      }

      await db.ventas_detalle.create({
        data: {
          venta_id: venta.id,
          tenant_id: user.tenantId,
          lote_id: linea.loteId,
          cantidad: linea.cantidad,
          precio_unitario: linea.precioUnitario,
        },
      });

      await db.lotes.update({
        where: { id: linea.loteId },
        data: { saldo: { decrement: linea.cantidad } },
      });

      await db.inventario_movimientos.create({
        data: {
          tenant_id: user.tenantId,
          lote_id: linea.loteId,
          tipo_movimiento_id: TIPO_MOV_SALIDA_VENTA,
          cantidad: linea.cantidad,
          referencia_id: venta.id,
          usuario_id: user.usuarioId,
        },
      });
    }

    await db.bitacora.create({
      data: {
        tenant_id: user.tenantId,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_VENTAS_ID,
        registro_id: venta.id,
        accion_id: ACCION_INSERT_ID,
      },
    });

    return venta;
  }

  listar(user: CurrentUserData, skip = 0, take = 20) {
    return this.prisma.getDb().ventas.findMany({
      where: { tenant_id: user.tenantId! },
      select: {
        id: true,
        fecha: true,
        total: true,
        clientes: { select: { id: true, nombre: true } },
      },
      orderBy: { fecha: 'desc' },
      skip,
      take,
    });
  }

  async obtenerUno(id: number, user: CurrentUserData) {
    const venta = await this.prisma.getDb().ventas.findFirst({
      where: { id, tenant_id: user.tenantId! },
      include: { ventas_detalle: { include: { lotes: true } } },
    });
    if (!venta) throw new BadRequestException('Venta no encontrada');
    return venta;
  }

  async resumen(user: CurrentUserData) {
    return this.prisma.getDb().ventas.groupBy({
      by: ['fecha'],
      where: { tenant_id: user.tenantId! },
      _sum: { total: true },
      orderBy: { fecha: 'desc' },
      take: 30,
    });
  }

  async anular(id: number, user: CurrentUserData) {
    if (!user.tenantId)
      throw new ForbiddenException('super_admin no anula ventas');
    const db = this.prisma.getDb();

    const venta = await db.ventas.findFirst({
      where: { id, tenant_id: user.tenantId },
      include: { ventas_detalle: true },
    });
    if (!venta) throw new BadRequestException('Venta no encontrada');
    if (venta.anulada)
      throw new BadRequestException('Esta venta ya fue anulada');

    for (const linea of venta.ventas_detalle) {
      await db.lotes.update({
        where: { id: linea.lote_id },
        data: { saldo: { increment: linea.cantidad } },
      });
      await db.inventario_movimientos.create({
        data: {
          tenant_id: user.tenantId,
          lote_id: linea.lote_id,
          tipo_movimiento_id: TIPO_MOV_AJUSTE_POSITIVO,
          cantidad: linea.cantidad,
          referencia_id: venta.id,
          usuario_id: user.usuarioId,
        },
      });
    }

    await db.ventas.update({ where: { id }, data: { anulada: true } });
    await db.bitacora.create({
      data: {
        tenant_id: user.tenantId,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_VENTAS_ID,
        registro_id: venta.id,
        accion_id: ACCION_UPDATE_ID,
      },
    });

    return { ok: true };
  }
}
