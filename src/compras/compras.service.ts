import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompraDto } from './dto/create-compra.dto';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';

const ESTADOS_VALIDOS_COMPRA = [1, 2, 3]; // uva, humedo, pergamino_seco
const TABLA_COMPRAS_ID = 1;
const ACCION_INSERT_ID = 1;
const ACCION_UPDATE_ID = 2;
const TIPO_MOV_AJUSTE_NEGATIVO = 6;

@Injectable()
export class ComprasService {
  constructor(private prisma: PrismaService) {}

  async crear(dto: CreateCompraDto, user: CurrentUserData) {
    if (!user.tenantId) {
      throw new ForbiddenException(
        'Un super_admin no registra compras directamente',
      );
    }
    for (const linea of dto.lineas) {
      if (!ESTADOS_VALIDOS_COMPRA.includes(linea.estadoCafeId)) {
        throw new BadRequestException(
          `estado_cafe_id ${linea.estadoCafeId} no es un estado válido de compra`,
        );
      }
    }

    const total = dto.lineas.reduce(
      (sum, l) => sum + l.cantidad * l.costoUnitario,
      0,
    );

    // Ya no abrimos $transaction aquí: el RlsInterceptor ya abrió una para
    // toda la petición (con SET LOCAL de rol/JWT incluido). getDb() la reusa.
    const db = this.prisma.getDb();

    const compra = await db.compras.create({
      data: {
        tenant_id: user.tenantId,
        proveedor_id: dto.proveedorId,
        usuario_id: user.usuarioId,
        metodo_pago_id: dto.metodoPagoId,
        total,
      },
    });

    for (const linea of dto.lineas) {
      await db.compras_detalle.create({
        data: {
          compra_id: compra.id,
          tenant_id: user.tenantId,
          estado_cafe_id: linea.estadoCafeId,
          variedad_id: linea.variedadId,
          altura_id: linea.alturaId,
          humedad: linea.humedad,
          cantidad: linea.cantidad,
          costo_unitario: linea.costoUnitario,
        },
      });
    }

    await db.bitacora.create({
      data: {
        tenant_id: user.tenantId,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_COMPRAS_ID,
        registro_id: compra.id,
        accion_id: ACCION_INSERT_ID,
      },
    });

    return compra;
  }

  async resumen(user: CurrentUserData) {
    return this.prisma.getDb().compras.groupBy({
      by: ['fecha'],
      where: { tenant_id: user.tenantId! },
      _sum: { total: true },
      orderBy: { fecha: 'desc' },
      take: 30,
    });
  }

  async listar(user: CurrentUserData, skip = 0, take = 20) {
    return this.prisma.getDb().compras.findMany({
      where: { tenant_id: user.tenantId! },
      select: {
        id: true,
        fecha: true,
        total: true,
        proveedores: { select: { id: true, nombre: true } },
        usuarios: { select: { id: true, nombre: true } },
      },
      orderBy: { fecha: 'desc' },
      skip,
      take,
    });
  }

  async obtenerUno(id: number, user: CurrentUserData) {
    const compra = await this.prisma.getDb().compras.findFirst({
      where: { id, tenant_id: user.tenantId! },
      include: { compras_detalle: { include: { lotes: true } } },
    });
    if (!compra) throw new BadRequestException('Compra no encontrada');
    return compra;
  }

  async anular(id: number, user: CurrentUserData) {
    if (!user.tenantId)
      throw new ForbiddenException('super_admin no anula compras');
    const db = this.prisma.getDb();

    const compra = await db.compras.findFirst({
      where: { id, tenant_id: user.tenantId },
      include: { compras_detalle: { include: { lotes: true } } },
    });
    if (!compra) throw new BadRequestException('Compra no encontrada');
    if (compra.anulada)
      throw new BadRequestException('Esta compra ya fue anulada');

    // No se permite anulación parcial: si cualquier lote generado ya tuvo una venta
    // o un procesamiento (su saldo se movió), se rechaza la anulación completa.
    const todosLotes = compra.compras_detalle.flatMap((d) => d.lotes);
    for (const lote of todosLotes) {
      if (Number(lote.saldo) !== Number(lote.cantidad_inicial)) {
        throw new BadRequestException(
          `El lote ${lote.id} ya tiene movimientos de venta o procesamiento -- no se puede anular la compra`,
        );
      }
    }

    for (const lote of todosLotes) {
      await db.lotes.update({ where: { id: lote.id }, data: { saldo: 0 } });
      await db.inventario_movimientos.create({
        data: {
          tenant_id: user.tenantId,
          lote_id: lote.id,
          tipo_movimiento_id: TIPO_MOV_AJUSTE_NEGATIVO,
          cantidad: lote.saldo,
          referencia_id: compra.id,
          usuario_id: user.usuarioId,
        },
      });
    }

    await db.compras.update({ where: { id }, data: { anulada: true } });
    await db.bitacora.create({
      data: {
        tenant_id: user.tenantId,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_COMPRAS_ID,
        registro_id: compra.id,
        accion_id: ACCION_UPDATE_ID,
      },
    });

    return { ok: true };
  }
}
