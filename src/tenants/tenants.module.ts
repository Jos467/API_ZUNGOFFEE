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

@Injectable()
class TenantsService {
  constructor(private prisma: PrismaService) {}

  crear(dto: CreateTenantDto) {
    return this.prisma.getDb().tenants.create({ data: { nombre: dto.nombre } });
  }

  listar() {
    return this.prisma.getDb().tenants.findMany({
      include: { estados_tenant: { select: { nombre: true } } },
      orderBy: { id: 'asc' },
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
    return this.prisma
      .getDb()
      .tenants.update({ where: { id }, data: { nombre: dto.nombre } });
  }

  async onboarding(dto: OnboardingDto) {
    const db = this.prisma.getDb();
    const tenant = await db.tenants.create({
      data: { nombre: dto.nombreBodega },
    });

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

    if (dto.solicitudId) {
      await db.solicitudes_registro.update({
        where: { id: dto.solicitudId },
        data: {
          estado_id: ESTADO_SOLICITUD_PROCESADA,
          tenant_creado_id: tenant.id,
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
  crear(@Body() dto: CreateTenantDto) {
    return this.service.crear(dto);
  }

  @Post('onboarding')
  @Roles('super_admin')
  onboarding(@Body() dto: OnboardingDto) {
    return this.service.onboarding(dto);
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
