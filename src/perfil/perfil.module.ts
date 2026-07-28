import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Injectable,
  Module,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { IsString } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { supabaseAdmin } from '../common/supabase-admin';

class ActualizarPerfilDto {
  @IsString() nombre: string;
}

const BUCKET_AVATARS = 'avatars';
const MIME_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const TAMANO_MAXIMO_BYTES = 5 * 1024 * 1024; // 5MB, igual que el limite del bucket

@Injectable()
class PerfilService {
  constructor(private prisma: PrismaService) {}

  private select() {
    return {
      id: true,
      nombre: true,
      estado: true,
      fecha_creacion: true,
      foto_url: true,
      roles: { select: { nombre: true } },
      tenants: { select: { id: true, nombre: true } },
    }; // nunca exponer auth_uid
  }

  obtener(user: CurrentUserData) {
    return this.prisma.getDb().usuarios.findUnique({
      where: { id: user.usuarioId },
      select: this.select(),
    });
  }

  actualizar(dto: ActualizarPerfilDto, user: CurrentUserData) {
    return this.prisma.getDb().usuarios.update({
      where: { id: user.usuarioId },
      data: { nombre: dto.nombre },
      select: this.select(),
    });
  }

  async subirFoto(file: Express.Multer.File | undefined, user: CurrentUserData) {
    if (!file) throw new BadRequestException('Falta el archivo (campo "foto")');
    if (!MIME_PERMITIDOS.includes(file.mimetype)) {
      throw new BadRequestException(
        `Formato no permitido (${file.mimetype}) -- solo jpeg, png o webp`,
      );
    }
    if (file.size > TAMANO_MAXIMO_BYTES) {
      throw new BadRequestException('La imagen no puede pesar más de 5MB');
    }

    // Path fijo = el propio id de usuario (sin extension) -- upsert siempre
    // pisa la foto anterior, nunca quedan archivos huerfanos en el bucket.
    const path = String(user.usuarioId);
    const { error } = await supabaseAdmin()
      .storage.from(BUCKET_AVATARS)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
    if (error) {
      throw new BadRequestException(`No se pudo subir la imagen: ${error.message}`);
    }

    const { data: pub } = supabaseAdmin()
      .storage.from(BUCKET_AVATARS)
      .getPublicUrl(path);
    // Cache-busting: el path es siempre el mismo (upsert), así que sin esto
    // el navegador/app puede seguir mostrando la foto vieja en cache.
    const fotoUrl = `${pub.publicUrl}?t=${Date.now()}`;

    return this.prisma.getDb().usuarios.update({
      where: { id: user.usuarioId },
      data: { foto_url: fotoUrl },
      select: this.select(),
    });
  }

  async eliminarFoto(user: CurrentUserData) {
    const actual = await this.prisma.getDb().usuarios.findUnique({
      where: { id: user.usuarioId },
      select: { foto_url: true },
    });
    if (!actual?.foto_url) {
      return this.obtener(user); // nada que borrar, idempotente
    }

    const path = String(user.usuarioId);
    const { error } = await supabaseAdmin().storage.from(BUCKET_AVATARS).remove([path]);
    if (error) {
      throw new BadRequestException(`No se pudo eliminar la imagen: ${error.message}`);
    }

    return this.prisma.getDb().usuarios.update({
      where: { id: user.usuarioId },
      data: { foto_url: null },
      select: this.select(),
    });
  }
}

@Controller('perfil')
@UseGuards(AuthGuard('jwt'))
class PerfilController {
  constructor(private readonly service: PerfilService) {}

  @Get()
  obtener(@CurrentUser() user: CurrentUserData) {
    return this.service.obtener(user);
  }

  @Patch()
  actualizar(
    @Body() dto: ActualizarPerfilDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.actualizar(dto, user);
  }

  @Post('foto')
  @UseInterceptors(FileInterceptor('foto'))
  subirFoto(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.subirFoto(file, user);
  }

  @Delete('foto')
  eliminarFoto(@CurrentUser() user: CurrentUserData) {
    return this.service.eliminarFoto(user);
  }
}

@Module({ controllers: [PerfilController], providers: [PerfilService] })
export class PerfilModule {}
