import { Controller, Get, Post, Body, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { ComprasService } from './compras.service';
import { CreateCompraDto } from './dto/create-compra.dto';

@Controller('compras')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ComprasController {
  constructor(private readonly comprasService: ComprasService) {}

  @Post()
  @Roles('admin_bodega', 'empleado')
  crear(@Body() dto: CreateCompraDto, @CurrentUser() user: CurrentUserData) {
    return this.comprasService.crear(dto, user);
  }

  // Estática ANTES que :id -- si esto va después, Nest interpreta "resumen"
  // como el parámetro :id y nunca llega a este handler.
  @Get('resumen')
  @Roles('admin_bodega')
  resumen(@CurrentUser() user: CurrentUserData) {
    return this.comprasService.resumen(user);
  }

  @Get()
  @Roles('admin_bodega', 'empleado')
  listar(@CurrentUser() user: CurrentUserData) {
    return this.comprasService.listar(user);
  }

  @Get(':id')
  @Roles('admin_bodega', 'empleado')
  obtenerUno(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserData) {
    return this.comprasService.obtenerUno(id, user);
  }
}
