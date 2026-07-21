import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsPositive, ValidateNested, ArrayMinSize } from 'class-validator';

class LineaVentaDto {
  @Type(() => Number) @IsInt() loteId: number; // acepta 2 o "2" (BigInt llega como string)
  @IsNumber() @IsPositive() cantidad: number;
  @IsNumber() @IsPositive() precioUnitario: number;
}

export class CreateVentaDto {
  @IsInt() clienteId: number;
  @IsOptional() @IsInt() metodoPagoId?: number;
  @ValidateNested({ each: true }) @Type(() => LineaVentaDto) @ArrayMinSize(1)
  lineas: LineaVentaDto[];
}
