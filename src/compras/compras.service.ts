import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompraDto } from './dto/create-compra.dto';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';

const ESTADOS_VALIDOS_COMPRA = [1, 2, 3]; // uva, humedo, pergamino_seco
const TABLA_COMPRAS_ID = 1;
const ACCION_INSERT_ID = 1;

@Injectable()
export class ComprasService {
  constructor(private prisma: PrismaService) {}

  async crear(dto: CreateCompraDto, user: CurrentUserData) {
    if (!user.tenantId) {
      throw new ForbiddenException('Un super_admin no registra compras directamente');
    }
    for (const linea of dto.lineas) {
      if (!ESTADOS_VALIDOS_COMPRA.includes(linea.estadoCafeId)) {
        throw new BadRequestException(`estado_cafe_id ${linea.estadoCafeId} no es un estado válido de compra`);
      }
    }

    const total = dto.lineas.reduce((sum, l) => sum + l.cantidad * l.costoUnitario, 0);

    // Ya no abrimos $transaction aquí: el RlsInterceptor ya abrió una para
    // toda la petición (con SET LOCAL de rol/JWT incluido). getDb() la reusa.
    const db = this.prisma.getDb();

    const compra = await db.compras.create({
      data: {
        tenant_id: user.tenantId!,
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

    await db.bitacora.create({
      data: {
        tenant_id: user.tenantId!,
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
        id: true, fecha: true, total: true,
        proveedores: { select: { id: true, nombre: true } },
        usuarios: { select: { id: true, nombre: true } },
      },
      orderBy: { fecha: 'desc' },
      skip, take,
    });
  }

  async obtenerUno(id: number, user: CurrentUserData) {
    const compra = await this.prisma.getDb().compras.findFirst({
      where: { id, tenant_id: user.tenantId! },
      include: { compras_detalle: true },
    });
    if (!compra) throw new BadRequestException('Compra no encontrada');
    return compra;
  }
}
