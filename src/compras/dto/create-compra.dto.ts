import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';

class LineaCompraDto {
  @IsInt()
  estadoCafeId: number; // debe ser uva/humedo/pergamino_seco -- se valida en el service

  @IsOptional()
  @IsInt()
  variedadId?: number;

  @IsOptional()
  @IsInt()
  alturaId?: number;

  @IsOptional()
  @IsNumber()
  humedad?: number;

  @IsNumber()
  @IsPositive()
  cantidad: number;

  @IsNumber()
  @IsPositive()
  costoUnitario: number;
}

export class CreateCompraDto {
  @IsInt()
  proveedorId: number;

  @IsOptional()
  @IsInt()
  metodoPagoId?: number;

  @ValidateNested({ each: true })
  @Type(() => LineaCompraDto)
  @ArrayMinSize(1)
  lineas: LineaCompraDto[];

  // NO hay campo tenantId ni usuarioId aquí a propósito -- ver 4.4 del prompt original.
}
