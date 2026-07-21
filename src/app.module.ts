import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ComprasModule } from './compras/compras.module';
import { VentasModule } from './ventas/ventas.module';
import { LotesModule } from './lotes/lotes.module';
import { ProcesamientoModule } from './procesamiento-cafe/procesamiento.module';
import { ProveedoresModule } from './proveedores/proveedores.module';
import { ClientesModule } from './clientes/clientes.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { ReportesModule } from './reportes/reportes.module';
import { PagosModule } from './pagos/pagos.module';
import { NotificacionesModule } from './notificaciones/notificaciones.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ComprasModule,
    VentasModule,
    LotesModule,
    ProcesamientoModule,
    ProveedoresModule,
    ClientesModule,
    UsuariosModule,
    ReportesModule,
    PagosModule,
    NotificacionesModule,
  ],
})
export class AppModule {}
