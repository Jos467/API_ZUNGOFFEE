import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVentaDto } from './dto/create-venta.dto';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { resolveTenantId } from '../common/resolve-tenant';
import { notificarAdminsDeTenant } from '../common/notificar';

const TABLA_VENTAS_ID = 5;
const ACCION_INSERT_ID = 1;
const ACCION_UPDATE_ID = 2;
const TIPO_MOV_SALIDA_VENTA = 2;
const TIPO_MOV_AJUSTE_POSITIVO = 5;
const TIPO_NOTIFICACION_VENTA_REGISTRADA = 3;

@Injectable()
export class VentasService {
  constructor(private prisma: PrismaService) {}

  async crear(dto: CreateVentaDto, user: CurrentUserData) {
    const tenantId = resolveTenantId(user, dto.tenantId);
    const db = this.prisma.getDb();

    const venta = await db.ventas.create({
      data: {
        tenant_id: tenantId,
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

      if (!lote || lote.tenant_id !== tenantId) {
        throw new BadRequestException(
          `Lote ${linea.loteId} no existe en ese tenant`,
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
          tenant_id: tenantId,
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
          tenant_id: tenantId,
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
        tenant_id: tenantId,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_VENTAS_ID,
        registro_id: venta.id,
        accion_id: ACCION_INSERT_ID,
      },
    });

    // usuario_id null + tenant_id => la ven todos los usuarios del tenant
    // (ver NotificacionesService.misNotificaciones); el push nativo solo va
    // al/los admin_bodega, ver notificarAdminsDeTenant().
    const tenant = await db.tenants.findUnique({
      where: { id: tenantId },
      select: { nombre: true },
    });
    await notificarAdminsDeTenant(this.prisma, tenantId, {
      tipoId: TIPO_NOTIFICACION_VENTA_REGISTRADA,
      titulo: 'Nueva venta registrada',
      mensaje: `${user.nombre} registró una venta de L. ${venta.total} en ${tenant?.nombre ?? tenantId}.`,
      data: {
        tipo: 'venta_registrada',
        tenantId: String(tenantId),
        referenciaId: String(venta.id),
      },
    });

    return venta;
  }

  listar(user: CurrentUserData, skip = 0, take = 20, tenantIdParam?: number) {
    return this.prisma.getDb().ventas.findMany({
      where: { tenant_id: resolveTenantId(user, tenantIdParam) },
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
      where:
        user.rol === 'super_admin' ? { id } : { id, tenant_id: user.tenantId! },
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
    const db = this.prisma.getDb();

    const venta = await db.ventas.findFirst({
      where:
        user.rol === 'super_admin' ? { id } : { id, tenant_id: user.tenantId! },
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
          tenant_id: venta.tenant_id,
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
        tenant_id: venta.tenant_id,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_VENTAS_ID,
        registro_id: venta.id,
        accion_id: ACCION_UPDATE_ID,
      },
    });

    return { ok: true };
  }
}
