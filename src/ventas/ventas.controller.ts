import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
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

  // Estática ANTES que :id -- ver el mismo comentario en compras.controller.ts
  @Get('resumen')
  @Roles('admin_bodega')
  resumen(@CurrentUser() user: CurrentUserData) {
    return this.service.resumen(user);
  }

  @Get()
  @Roles('admin_bodega', 'empleado')
  listar(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const take = Math.min(Number(pageSize) || 20, 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    return this.service.listar(user, skip, take);
  }

  @Get(':id')
  @Roles('admin_bodega', 'empleado')
  obtenerUno(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.obtenerUno(id, user);
  }

  @Patch(':id/anular')
  @Roles('admin_bodega')
  anular(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.anular(id, user);
  }
}
