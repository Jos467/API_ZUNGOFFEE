import { Controller, Get, Post, Body, UseGuards, Injectable, Module } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsString } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

class CreateTenantDto {
  @IsString() nombre: string;
}

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
}

@Controller('tenants')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
class TenantsController {
  constructor(private readonly service: TenantsService) {}

  @Post()
  crear(@Body() dto: CreateTenantDto) {
    return this.service.crear(dto);
  }

  @Get()
  listar() {
    return this.service.listar();
  }
}

@Module({ controllers: [TenantsController], providers: [TenantsService] })
export class TenantsModule {}
