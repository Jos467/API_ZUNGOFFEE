import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

// Prisma devuelve BigInt nativo para columnas BIGINT/BIGSERIAL (lotes, bitacora,
// procesamiento_cafe, inventario_movimientos). JSON.stringify no sabe serializarlo
// por defecto -- esto lo convierte a string automáticamente en toda respuesta.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Zungo Coffee API')
    .setDescription('API REST para gestión de bodegas de café')
    .setVersion('1.0')
    .addBearerAuth() // pega el JWT de Supabase en el botón "Authorize" de /docs
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
