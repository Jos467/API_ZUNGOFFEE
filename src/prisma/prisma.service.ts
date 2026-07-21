import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { rlsStorage } from '../common/rls-context';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private pool: Pool;

  constructor(config: ConfigService) {
    const pool = new Pool({ connectionString: config.get<string>('DATABASE_URL') });
    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;
  }

  // Todo el código de negocio debe usar esto en vez de `this.prisma.X` directo,
  // salvo jwt.strategy.ts (que resuelve identidad ANTES de que exista contexto RLS).
  getDb() {
    return rlsStorage.getStore()?.tx ?? this;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
