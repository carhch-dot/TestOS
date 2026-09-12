import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { HealthService } from './health.service';

@Module({
  imports: [PrismaModule],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
