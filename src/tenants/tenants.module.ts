import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Injectable,
  Module,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  IsString,
  IsEmail,
  IsOptional,
  IsInt,
  MinLength,
} from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { supabaseAdmin } from '../common/supabase-admin';
import { estadoPagoCalculado, diasRestantes } from '../common/estado-pago';

class CreateTenantDto {
  @IsString() nombre: string;
}

class ActualizarTenantDto {
  @IsString() nombre: string;
}

class OnboardingDto {
  @IsString() nombreBodega: string;
  @IsEmail() emailAdmin: string;
  @IsString() @MinLength(8) passwordAdmin: string;
  @IsString() nombreAdmin: string;
  @IsOptional() @IsInt() solicitudId?: number;
}

const ROL_ADMIN_BODEGA = 2;
const ESTADO_SOLICITUD_PROCESADA = 2;
const TABLA_TENANTS_ID = 10;
const TABLA_SOLICITUDES_ID = 11;
const ACCION_INSERT_ID = 1;
const ACCION_UPDATE_ID = 2;
const DIAS_PRUEBA_GRATUITA = 7;

@Injectable()
class TenantsService {
  constructor(private prisma: PrismaService) {}

  // Se llama al crear cualquier tenant nuevo (POST /tenants y onboarding).
  // Monto 0 -- es solo el periodo de prueba, no un cobro real. El
  // estado_calculado (ver estado-pago.ts) hace que esto se vea "vencido"
  // solo con que pase la fecha sin que se registre un pago real encima.
  private async crearCicloPrueba(tenantId: number) {
    const hoy = new Date();
    const vencimiento = new Date(hoy);
    vencimiento.setDate(vencimiento.getDate() + DIAS_PRUEBA_GRATUITA);
    await this.prisma.getDb().pagos_tenant.create({
      data: {
        tenant_id: tenantId,
        periodo: hoy,
        monto: 0,
        fecha_vencimiento: vencimiento,
      },
    });
  }

  async crear(dto: CreateTenantDto, user: CurrentUserData) {
    const db = this.prisma.getDb();
    const tenant = await db.tenants.create({ data: { nombre: dto.nombre } });
    await this.crearCicloPrueba(tenant.id);
    await db.bitacora.create({
      data: {
        tenant_id: tenant.id,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_TENANTS_ID,
        registro_id: tenant.id,
        accion_id: ACCION_INSERT_ID,
      },
    });
    return tenant;
  }

  async listar() {
    const db = this.prisma.getDb();
    const tenants = await db.tenants.findMany({
      include: { estados_tenant: { select: { nombre: true } } },
      orderBy: { id: 'asc' },
    });

    // Un solo query trae el ciclo de pago "vigente" (el de vencimiento mas
    // lejano) de cada tenant, en vez de N queries -- uno por fila de la tabla.
    const ciclosVigentes = await db.$queryRaw<
      {
        tenant_id: number;
        fecha_vencimiento: Date;
        fecha_pago: Date | null;
        monto: any;
      }[]
    >`
      SELECT DISTINCT ON (tenant_id) tenant_id, fecha_vencimiento, fecha_pago, monto
      FROM pagos_tenant
      ORDER BY tenant_id, fecha_vencimiento DESC
    `;
    const cicloPorTenant = new Map(
      ciclosVigentes.map((c) => [c.tenant_id, c]),
    );

    // Un solo query trae el admin_bodega de cada tenant (con su email real,
    // que vive en auth.users, no en la tabla usuarios) -- si un tenant
    // tuviera mas de un admin_bodega (no debería pasar hoy, solo onboarding
    // crea uno), se queda con el de id mas bajo.
    const admins = await db.usuarios.findMany({
      where: {
        tenant_id: { in: tenants.map((t) => t.id) },
        rol_id: ROL_ADMIN_BODEGA,
      },
      select: {
        tenant_id: true,
        nombre: true,
        users: { select: { email: true } },
      },
      orderBy: { id: 'asc' },
    });
    const adminPorTenant = new Map<number, { nombre: string; email: string | null }>();
    for (const a of admins) {
      if (a.tenant_id !== null && !adminPorTenant.has(a.tenant_id)) {
        adminPorTenant.set(a.tenant_id, { nombre: a.nombre, email: a.users.email });
      }
    }

    return tenants.map((t) => {
      const ciclo = cicloPorTenant.get(t.id);
      const admin = adminPorTenant.get(t.id) ?? null;
      if (!ciclo) {
        // No debería pasar para tenants creados desde ahora (siempre se les
        // crea el ciclo de prueba), pero sí para tenants viejos ya existentes
        // antes de este cambio.
        return { ...t, dias_restantes: null, estado_pago_calculado: null, admin };
      }
      return {
        ...t,
        dias_restantes: diasRestantes(ciclo.fecha_vencimiento),
        estado_pago_calculado: estadoPagoCalculado(
          ciclo.fecha_pago,
          ciclo.fecha_vencimiento,
        ),
        admin,
      };
    });
  }

  async actualizar(
    id: number,
    dto: ActualizarTenantDto,
    user: CurrentUserData,
  ) {
    if (user.rol !== 'super_admin' && id !== user.tenantId) {
      throw new ForbiddenException('No puedes editar otro tenant');
    }
    const db = this.prisma.getDb();
    const tenant = await db.tenants.update({
      where: { id },
      data: { nombre: dto.nombre },
    });
    await db.bitacora.create({
      data: {
        tenant_id: id,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_TENANTS_ID,
        registro_id: id,
        accion_id: ACCION_UPDATE_ID,
      },
    });
    return tenant;
  }

  async onboarding(dto: OnboardingDto, user: CurrentUserData) {
    const db = this.prisma.getDb();
    const tenant = await db.tenants.create({
      data: { nombre: dto.nombreBodega },
    });
    await this.crearCicloPrueba(tenant.id);

    const { data, error } = await supabaseAdmin().auth.admin.createUser({
      email: dto.emailAdmin,
      password: dto.passwordAdmin,
      email_confirm: true,
    });

    if (error || !data.user) {
      // No hacemos rollback manual del tenant: toda esta petición ya corre dentro
      // de la transacción que abre el RlsInterceptor por request, así que lanzar
      // aquí revierte también el tenants.create de arriba automáticamente.
      throw new BadRequestException(
        error?.message ?? 'No se pudo crear el usuario en Supabase Auth',
      );
    }

    const usuario = await db.usuarios.create({
      data: {
        tenant_id: tenant.id,
        auth_uid: data.user.id,
        rol_id: ROL_ADMIN_BODEGA,
        nombre: dto.nombreAdmin,
      },
    });

    await db.bitacora.create({
      data: {
        tenant_id: tenant.id,
        usuario_id: user.usuarioId,
        tabla_afectada_id: TABLA_TENANTS_ID,
        registro_id: tenant.id,
        accion_id: ACCION_INSERT_ID,
      },
    });

    if (dto.solicitudId) {
      await db.solicitudes_registro.update({
        where: { id: dto.solicitudId },
        data: {
          estado_id: ESTADO_SOLICITUD_PROCESADA,
          tenant_creado_id: tenant.id,
        },
      });
      await db.bitacora.create({
        data: {
          tenant_id: tenant.id,
          usuario_id: user.usuarioId,
          tabla_afectada_id: TABLA_SOLICITUDES_ID,
          registro_id: dto.solicitudId,
          accion_id: ACCION_UPDATE_ID,
        },
      });
    }

    return { tenant, usuario };
  }
}

@Controller('tenants')
@UseGuards(AuthGuard('jwt'), RolesGuard)
class TenantsController {
  constructor(private readonly service: TenantsService) {}

  @Post()
  @Roles('super_admin')
  crear(@Body() dto: CreateTenantDto, @CurrentUser() user: CurrentUserData) {
    return this.service.crear(dto, user);
  }

  @Post('onboarding')
  @Roles('super_admin')
  onboarding(
    @Body() dto: OnboardingDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.onboarding(dto, user);
  }

  @Get()
  @Roles('super_admin')
  listar() {
    return this.service.listar();
  }

  @Patch(':id')
  @Roles('super_admin', 'admin_bodega')
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarTenantDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.actualizar(id, dto, user);
  }
}

@Module({ controllers: [TenantsController], providers: [TenantsService] })
export class TenantsModule {}
