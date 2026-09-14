import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import {
  PasswordResetController,
  FORGOT_PASSWORD_MESSAGE,
  RESET_PASSWORD_FAILED_MESSAGE,
} from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';

describe('PasswordResetController', () => {
  let passwordResetService: {
    requestReset: jest.Mock;
    confirmReset: jest.Mock;
  };
  let controller: PasswordResetController;

  beforeEach(async () => {
    passwordResetService = {
      requestReset: jest.fn().mockResolvedValue(undefined),
      confirmReset: jest.fn().mockResolvedValue(true),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [PasswordResetController],
      providers: [
        { provide: PasswordResetService, useValue: passwordResetService },
      ],
    }).compile();

    controller = moduleRef.get(PasswordResetController);
  });

  describe('forgotPassword', () => {
    it('delegates to requestReset and returns the generic message for well-formed email', async () => {
      const result = await controller.forgotPassword({
        email: 'user@example.com',
      });

      expect(passwordResetService.requestReset).toHaveBeenCalledWith(
        'user@example.com',
      );
      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
    });

    it('returns the same generic message without calling the service when email is missing', async () => {
      const result = await controller.forgotPassword(
        {} as { email: string },
      );

      expect(passwordResetService.requestReset).not.toHaveBeenCalled();
      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
    });

    it('returns the same generic message without calling the service when the body itself is missing', async () => {
      const result = await controller.forgotPassword(
        undefined as unknown as { email: string },
      );

      expect(passwordResetService.requestReset).not.toHaveBeenCalled();
      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
    });

    it('returns the same generic message without calling the service when email is empty', async () => {
      const result = await controller.forgotPassword({ email: '' });

      expect(passwordResetService.requestReset).not.toHaveBeenCalled();
      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
    });

    it('returns the same generic message without calling the service when email exceeds the length cap', async () => {
      const result = await controller.forgotPassword({
        email: `${'a'.repeat(250)}@example.com`,
      });

      expect(passwordResetService.requestReset).not.toHaveBeenCalled();
      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
    });

    const nonStringCases: Array<[string, unknown]> = [
      ['a number', 12345],
      ['null', null],
      ['an object', { foo: 'bar' }],
      ['an array', ['a', 'b']],
    ];

    it.each(nonStringCases)(
      'returns the same generic message without calling the service when email is %s',
      async (_description, email) => {
        const result = await controller.forgotPassword({
          email,
        } as unknown as { email: string });

        expect(passwordResetService.requestReset).not.toHaveBeenCalled();
        expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      },
    );
  });

  describe('resetPassword', () => {
    it('delegates to confirmReset and returns a success message', async () => {
      const result = await controller.resetPassword({
        token: 'raw-token',
        newPassword: 'new-password',
      });

      expect(passwordResetService.confirmReset).toHaveBeenCalledWith(
        'raw-token',
        'new-password',
      );
      expect(result).toEqual({ message: 'Your password has been reset.' });
    });

    it('rejects with the generic message when confirmReset returns false, never leaking why', async () => {
      passwordResetService.confirmReset.mockResolvedValue(false);

      await expect(
        controller.resetPassword({
          token: 'unknown-token',
          newPassword: 'new-password',
        }),
      ).rejects.toThrow(RESET_PASSWORD_FAILED_MESSAGE);
    });

    it('rejects with the generic message when token is missing, never calling the service', async () => {
      await expect(
        controller.resetPassword({
          newPassword: 'new-password',
        } as unknown as { token: string; newPassword: string }),
      ).rejects.toThrow(RESET_PASSWORD_FAILED_MESSAGE);
      expect(passwordResetService.confirmReset).not.toHaveBeenCalled();
    });

    it('rejects with the generic message when token is empty', async () => {
      await expect(
        controller.resetPassword({
          token: '',
          newPassword: 'new-password',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(passwordResetService.confirmReset).not.toHaveBeenCalled();
    });

    it('rejects with the generic message when token exceeds the length cap', async () => {
      await expect(
        controller.resetPassword({
          token: 'a'.repeat(513),
          newPassword: 'new-password',
        }),
      ).rejects.toThrow(RESET_PASSWORD_FAILED_MESSAGE);
      expect(passwordResetService.confirmReset).not.toHaveBeenCalled();
    });

    const nonStringTokenCases: Array<[string, unknown]> = [
      ['a number', 12345],
      ['null', null],
      ['an object', { foo: 'bar' }],
      ['an array', ['a', 'b']],
    ];

    it.each(nonStringTokenCases)(
      'rejects with the generic message when token is %s, never calling the service',
      async (_description, token) => {
        await expect(
          controller.resetPassword({
            token,
            newPassword: 'new-password',
          } as unknown as { token: string; newPassword: string }),
        ).rejects.toThrow(RESET_PASSWORD_FAILED_MESSAGE);
        expect(passwordResetService.confirmReset).not.toHaveBeenCalled();
      },
    );

    it('rejects with the generic message when newPassword is missing, never calling the service', async () => {
      await expect(
        controller.resetPassword({
          token: 'raw-token',
        } as unknown as { token: string; newPassword: string }),
      ).rejects.toThrow(RESET_PASSWORD_FAILED_MESSAGE);
      expect(passwordResetService.confirmReset).not.toHaveBeenCalled();
    });

    it('rejects with the generic message when newPassword is empty', async () => {
      await expect(
        controller.resetPassword({
          token: 'raw-token',
          newPassword: '',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(passwordResetService.confirmReset).not.toHaveBeenCalled();
    });

    it('rejects with the generic message when newPassword exceeds the length cap', async () => {
      await expect(
        controller.resetPassword({
          token: 'raw-token',
          newPassword: 'a'.repeat(1025),
        }),
      ).rejects.toThrow(RESET_PASSWORD_FAILED_MESSAGE);
      expect(passwordResetService.confirmReset).not.toHaveBeenCalled();
    });

    it('rejects with the generic message when the body itself is missing', async () => {
      await expect(
        controller.resetPassword(
          undefined as unknown as { token: string; newPassword: string },
        ),
      ).rejects.toThrow(RESET_PASSWORD_FAILED_MESSAGE);
      expect(passwordResetService.confirmReset).not.toHaveBeenCalled();
    });
  });
});
