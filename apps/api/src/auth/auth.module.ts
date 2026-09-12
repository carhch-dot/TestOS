import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BootstrapService } from './bootstrap.service';

/**
 * AuthModule owns `Usuario` end to end (AD-1). No other module ever
 * injects Prisma to write it.
 */
@Module({
  imports: [PrismaModule],
  providers: [BootstrapService],
})
export class AuthModule {}
