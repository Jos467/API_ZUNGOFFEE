import { Controller, Get, UseGuards, Injectable, Module } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
class CatalogosService {
  constructor(private prisma: PrismaService) {}

  async obtenerTodos() {
    const db = this.prisma.getDb();
    const [
      estadosCafe,
      variedadesCafe,
      nivelesAltura,
      proveedoresTipo,
      clientesTipo,
      metodosPago,
      unidadesMedida,
    ] = await Promise.all([
      db.estados_cafe.findMany({ orderBy: { id: 'asc' } }),
      db.variedades_cafe.findMany({ orderBy: { id: 'asc' } }),
      db.niveles_altura.findMany({ orderBy: { id: 'asc' } }),
      db.proveedores_tipo.findMany({ orderBy: { id: 'asc' } }),
      db.clientes_tipo.findMany({ orderBy: { id: 'asc' } }),
      db.metodos_pago.findMany({ orderBy: { id: 'asc' } }),
      db.unidades_medida.findMany({ orderBy: { id: 'asc' } }),
    ]);

    return {
      estadosCafe,
      variedadesCafe,
      nivelesAltura,
      proveedoresTipo,
      clientesTipo,
      metodosPago,
      unidadesMedida,
    };
  }
}

@Controller('catalogos')
@UseGuards(AuthGuard('jwt'))
class CatalogosController {
  constructor(private readonly service: CatalogosService) {}

  @Get()
  obtenerTodos() {
    return this.service.obtenerTodos();
  }
}

@Module({ controllers: [CatalogosController], providers: [CatalogosService] })
export class CatalogosModule {}
