import { Controller, Get, Post, Body, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { VentasService } from './ventas.service';
import { CreateVentaDto } from './dto/create-venta.dto';

@Controller('ventas')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class VentasController {
  constructor(private readonly service: VentasService) {}

  @Post()
  @Roles('admin_bodega', 'empleado')
  crear(@Body() dto: CreateVentaDto, @CurrentUser() user: CurrentUserData) {
    return this.service.crear(dto, user);
  }

  @Get()
  @Roles('admin_bodega', 'empleado')
  listar(@CurrentUser() user: CurrentUserData) {
    return this.service.listar(user);
  }

  @Get(':id')
  @Roles('admin_bodega', 'empleado')
  obtenerUno(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserData) {
    return this.service.obtenerUno(id, user);
  }
}
