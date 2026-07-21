import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '../../generated/prisma/client';

export interface RlsStore {
  tx: Prisma.TransactionClient;
}

export const rlsStorage = new AsyncLocalStorage<RlsStore>();
