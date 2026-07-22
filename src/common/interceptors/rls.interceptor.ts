import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, from, lastValueFrom } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { rlsStorage } from '../rls-context';

@Injectable()
export class RlsInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    if (!user) return next.handle(); // rutas públicas, si algún día existen

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
