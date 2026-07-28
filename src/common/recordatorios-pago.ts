import type { PrismaService } from '../prisma/prisma.service';
import { notificarSuperAdmins } from './notificar';
import { diasRestantes } from './estado-pago';

const ROL_ADMIN_BODEGA = 2;
const TIPO_NOTIFICACION_PAGO_PENDIENTE = 1;
const DIAS_AVISO = 5;

// Sin cron (Render free tier no tiene proceso de fondo persistente): esto se
// llama "de paso" en cualquier request autenticado (ver RlsInterceptor), con
// throttle en memoria para no pegarle a la base de datos en cada peticion.
// aviso_5_dias_enviado evita que se repita el aviso una vez mandado.
export async function revisarVencimientosProximos(prisma: PrismaService) {
  const vigentes = await prisma.$queryRaw<
    { id: number; tenant_id: number; fecha_vencimiento: Date; tenant_nombre: string }[]
  >`
    WITH vigente AS (
      SELECT DISTINCT ON (tenant_id) id, tenant_id, fecha_vencimiento, fecha_pago, aviso_5_dias_enviado
      FROM pagos_tenant
      ORDER BY tenant_id, fecha_vencimiento DESC
    )
    SELECT v.id, v.tenant_id, v.fecha_vencimiento, t.nombre AS tenant_nombre
    FROM vigente v
    JOIN tenants t ON t.id = v.tenant_id
    WHERE v.fecha_pago IS NULL
      AND v.aviso_5_dias_enviado = false
      AND (v.fecha_vencimiento::date - CURRENT_DATE) BETWEEN 0 AND ${DIAS_AVISO}
  `;

  for (const ciclo of vigentes) {
    const admin = await prisma.usuarios.findFirst({
      where: { tenant_id: ciclo.tenant_id, rol_id: ROL_ADMIN_BODEGA },
      select: { nombre: true },
      orderBy: { id: 'asc' },
    });
    const dias = diasRestantes(ciclo.fecha_vencimiento);
    const plural = dias === 1 ? 'día' : 'días';

    await notificarSuperAdmins(prisma, {
      tipoId: TIPO_NOTIFICACION_PAGO_PENDIENTE,
      titulo: 'Suscripción por expirar',
      mensaje: `La suscripción de ${admin?.nombre ?? 'el administrador'} (${ciclo.tenant_nombre}) expira en ${dias} ${plural}. Revisa sus pagos.`,
      data: { tipo: 'pago_pendiente', tenantId: String(ciclo.tenant_id) },
    });

    await prisma.pagos_tenant.update({
      where: { id: ciclo.id },
      data: { aviso_5_dias_enviado: true },
    });
  }
}
