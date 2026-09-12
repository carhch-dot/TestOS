import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Shared outbound-email module (AD-9). Any module that needs to send mail
 * imports `MailModule` and injects `MailService`.
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
