import { Logger } from '@nestjs/common';
import { firebaseMessaging } from './firebase-admin';
import type { PrismaService } from '../prisma/prisma.service';

const logger = new Logger('Notificar');

const ROL_SUPER_ADMIN = 1;
const ROL_ADMIN_BODEGA = 2;

interface PushPayload {
  tipoId: number;
  titulo: string;
  mensaje: string;
  data: Record<string, string>;
}

// IMPORTANTE: siempre recibe `prisma` (la conexión base, sin el SET LOCAL
// ROLE authenticated que pone el RlsInterceptor por request) y nunca
// `db`/getDb(). Mandar un push cruza usuarios -- ej. un admin_bodega
// necesita poder ver/tocar el dispositivo de OTRO usuario (otro admin_bodega,
// o todos los super_admin) -- eso viola las policies de RLS pensadas para que
// cada quien solo toque lo suyo. Este es un efecto de sistema, no una
// operación del usuario que disparó el request, por eso corre bypasseando RLS
// (mismo criterio que supabaseAdmin() en otras partes del proyecto).
//
// Todo esto está envuelto en try/catch a propósito: si Firebase está caído o
// pasa cualquier error acá, NUNCA debe tumbar la compra/venta/solicitud que
// lo disparó -- esa ya se guardó, el push es un efecto secundario best-effort.

async function enviarPush(
  prisma: PrismaService,
  tokens: string[],
  titulo: string,
  mensaje: string,
  data: Record<string, string>,
) {
  if (tokens.length === 0) return;

  const respuesta = await firebaseMessaging().sendEachForMulticast({
    tokens,
    notification: { title: titulo, body: mensaje },
    data,
  });

  const tokensInvalidos: string[] = [];
  respuesta.responses.forEach((r, i) => {
    if (
      !r.success &&
      (r.error?.code === 'messaging/registration-token-not-registered' ||
        r.error?.code === 'messaging/invalid-registration-token' ||
        r.error?.code === 'messaging/invalid-argument')
    ) {
      tokensInvalidos.push(tokens[i]);
    }
  });
  if (tokensInvalidos.length > 0) {
    await prisma.dispositivos_push.updateMany({
      where: { token: { in: tokensInvalidos } },
      data: { activo: false },
    });
  }
}

async function tokensDeUsuarios(
  prisma: PrismaService,
  usuarioIds: number[],
): Promise<string[]> {
  if (usuarioIds.length === 0) return [];
  const dispositivos = await prisma.dispositivos_push.findMany({
    where: { usuario_id: { in: usuarioIds }, activo: true },
    select: { token: true },
  });
  return dispositivos.map((d) => d.token);
}

// tenant_id null + usuario_id null => la ve cualquier super_admin en la
// bandeja in-app (mismo criterio que ya usaba SolicitudesService.crear()).
export async function notificarSuperAdmins(prisma: PrismaService, payload: PushPayload) {
  try {
    const notificacion = await prisma.notificaciones.create({
      data: {
        tenant_id: null,
        usuario_id: null,
        tipo_id: payload.tipoId,
        titulo: payload.titulo,
        mensaje: payload.mensaje,
      },
    });

    const superAdmins = await prisma.usuarios.findMany({
      where: { rol_id: ROL_SUPER_ADMIN },
      select: { id: true },
    });
    const tokens = await tokensDeUsuarios(
      prisma,
      superAdmins.map((u) => u.id),
    );
    await enviarPush(prisma, tokens, payload.titulo, payload.mensaje, payload.data);

    await prisma.notificaciones.update({
      where: { id: notificacion.id },
      data: { push_enviado: true },
    });
  } catch (err) {
    logger.error('Fallo notificando a super_admins', err as Error);
  }
}

// tenant_id => la ve todo el tenant en la bandeja in-app (mismo criterio que
// ya usaban ComprasService/VentasService), pero el push nativo solo se manda
// al/los admin_bodega de ese tenant -- el empleado que hizo la operacion no
// necesita que le llegue un push por su propia accion.
export async function notificarAdminsDeTenant(
  prisma: PrismaService,
  tenantId: number,
  payload: PushPayload,
) {
  try {
    const notificacion = await prisma.notificaciones.create({
      data: {
        tenant_id: tenantId,
        usuario_id: null,
        tipo_id: payload.tipoId,
        titulo: payload.titulo,
        mensaje: payload.mensaje,
      },
    });

    const admins = await prisma.usuarios.findMany({
      where: { rol_id: ROL_ADMIN_BODEGA, tenant_id: tenantId },
      select: { id: true },
    });
    const tokens = await tokensDeUsuarios(
      prisma,
      admins.map((u) => u.id),
    );
    await enviarPush(prisma, tokens, payload.titulo, payload.mensaje, payload.data);

    await prisma.notificaciones.update({
      where: { id: notificacion.id },
      data: { push_enviado: true },
    });
  } catch (err) {
    logger.error(`Fallo notificando a admins del tenant ${tenantId}`, err as Error);
  }
}
