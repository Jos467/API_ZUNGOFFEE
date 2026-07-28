import {
  Injectable,
  Logger,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, from, lastValueFrom } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { rlsStorage } from '../rls-context';
import { revisarVencimientosProximos } from '../recordatorios-pago';

const THROTTLE_RECORDATORIOS_MS = 10 * 60 * 1000; // 10 min entre revisiones
let ultimaRevisionRecordatorios = 0;

@Injectable()
export class RlsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RlsInterceptor.name);

  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    if (!user) return next.handle(); // rutas públicas, si algún día existen

    // Fire-and-forget: nunca debe bloquear ni tumbar el request que la disparó.
    // Throttle en memoria porque no hay cron (ver recordatorios-pago.ts) --
    // sin esto, cada request autenticado dispararía el query.
    const ahora = Date.now();
    if (ahora - ultimaRevisionRecordatorios > THROTTLE_RECORDATORIOS_MS) {
      ultimaRevisionRecordatorios = ahora;
      revisarVencimientosProximos(this.prisma).catch((err) =>
        this.logger.error('Fallo revisando vencimientos próximos', err),
      );
    }

    // authUid es un UUID validado por jose -- seguro para interpolar en SQL,
    // pero igual usamos $executeRawUnsafe con cuidado, sin texto libre del usuario.
    const claims = JSON.stringify({ sub: user.authUid, role: 'authenticated' });

    return from(
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE authenticated`);
        await tx.$executeRawUnsafe(
          `SET LOCAL "request.jwt.claims" TO '${claims}'`,
        );
        return rlsStorage.run({ tx }, () => lastValueFrom(next.handle()));
      }),
    );
  }
}
