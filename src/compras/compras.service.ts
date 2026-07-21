import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompraDto } from './dto/create-compra.dto';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';

// IDs del seed de estados_cafe que SÍ son válidos al comprar
// (tostado_alto/medio/bajo y molido solo se generan por procesamiento, nunca por compra directa)
const ESTADOS_VALIDOS_COMPRA = [1, 2, 3]; // uva, humedo, pergamino_seco

const TABLA_COMPRAS_ID = 1; // ver seed de tablas_sistema
const ACCION_INSERT_ID = 1; // ver seed de acciones_bitacora

@Injectable()
export class ComprasService {
  constructor(private prisma: PrismaService) {}

  async crear(dto: CreateCompraDto, user: CurrentUserData) {
    if (!user.tenantId) {
      throw new ForbiddenException('Un super_admin no registra compras directamente');
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

    // Todo en una sola transacción: si algo falla, no queda una compra "a medias".
    return this.prisma.$transaction(async (tx) => {
      const compra = await tx.compras.create({
        data: {
          tenant_id: user.tenantId!,
          proveedor_id: dto.proveedorId,
          usuario_id: user.usuarioId,
          metodo_pago_id: dto.metodoPagoId,
          total,
        },
      });

      // Insertar cada línea -- el trigger trg_crear_lote_desde_compra
      // se encarga de crear el lote correspondiente, no lo hacemos aquí.
      for (const linea of dto.lineas) {
        await tx.compras_detalle.create({
          data: {
            compra_id: compra.id,
            tenant_id: user.tenantId!,
            estado_cafe_id: linea.estadoCafeId,
            variedad_id: linea.variedadId,
            altura_id: linea.alturaId,
            humedad: linea.humedad,
            cantidad: linea.cantidad,
            costo_unitario: linea.costoUnitario,
          },
        });
      }

      await tx.bitacora.create({
        data: {
          tenant_id: user.tenantId!,
          usuario_id: user.usuarioId,
          tabla_afectada_id: TABLA_COMPRAS_ID,
          registro_id: compra.id,
          accion_id: ACCION_INSERT_ID,
        },
      });

      return compra;
    });
  }

  // Ruta estática (/compras/resumen) -- va antes de :id en el controller
  async resumen(user: CurrentUserData) {
    return this.prisma.compras.groupBy({
      by: ['fecha'],
      where: { tenant_id: user.tenantId! },
      _sum: { total: true },
      orderBy: { fecha: 'desc' },
      take: 30,
    });
  }

  async listar(user: CurrentUserData) {
    return this.prisma.compras.findMany({
      where: { tenant_id: user.tenantId! },
      select: {
        id: true,
        fecha: true,
        total: true,
        proveedores: { select: { id: true, nombre: true } }, // select explícito
        usuarios: { select: { id: true, nombre: true } },    // nunca traer auth_uid ni password
      },
      orderBy: { fecha: 'desc' },
    });
  }

  async obtenerUno(id: number, user: CurrentUserData) {
    const compra = await this.prisma.compras.findFirst({
      where: { id, tenant_id: user.tenantId! }, // tenant_id SIEMPRE en el where
      include: { compras_detalle: true },
    });
    if (!compra) throw new BadRequestException('Compra no encontrada');
    return compra;
  }
}
