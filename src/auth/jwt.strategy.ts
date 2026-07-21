import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-custom';
import { Request } from 'express';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    super();
    this.jwks = createRemoteJWKSet(
      new URL(this.config.get<string>('SUPABASE_JWKS_URL')!),
    );
  }

  async validate(req: Request) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token no proporcionado');
    }
    const token = authHeader.slice(7);

    let payload: any;
    try {
      const result = await jwtVerify(token, this.jwks, {
        audience: 'authenticated',
      });
      payload = result.payload;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    // payload.sub es el auth_uid (UUID de Supabase Auth) -- lo resolvemos
    // a la identidad interna INT que usa el resto del sistema.
    const usuario = await this.prisma.usuarios.findUnique({
      where: { auth_uid: payload.sub as string },
      select: {
        id: true,
        tenant_id: true,
        nombre: true,
        estado: true,
        roles: { select: { nombre: true } },
        tenants: { select: { estado_id: true } }, // 2 = suspendido, ver seed estados_tenant
      },
    });

    if (!usuario || !usuario.estado) {
      throw new UnauthorizedException('Usuario no reconocido o inactivo');
    }

    if (usuario.tenant_id && usuario.tenants?.estado_id === 2) {
      throw new UnauthorizedException('Bodega suspendida por falta de pago. Contacta al administrador de la plataforma.');
    }


    // Esto es lo único que debe usarse como identidad en toda la API.
    // Nunca confiar en un tenant_id o usuario_id que venga del body del request.
    return {
      usuarioId: usuario.id,
      tenantId: usuario.tenant_id,
      authUid: payload.sub as string,
      nombre: usuario.nombre,
      rol: usuario.roles.nombre,
    };
  }
}
