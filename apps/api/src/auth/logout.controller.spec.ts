import { Test } from '@nestjs/testing';
import { LogoutController } from './logout.controller';
import { RefreshTokenService } from './refresh-token.service';

describe('LogoutController', () => {
  let refreshTokenService: { revoke: jest.Mock };
  let controller: LogoutController;

  beforeEach(async () => {
    refreshTokenService = {
      revoke: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [LogoutController],
      providers: [
        { provide: RefreshTokenService, useValue: refreshTokenService },
      ],
    }).compile();

    controller = moduleRef.get(LogoutController);
  });

  it('revokes the given refresh token', async () => {
    await controller.logout({ refreshToken: 'some-raw-token' });

    expect(refreshTokenService.revoke).toHaveBeenCalledWith('some-raw-token');
  });

  it('resolves without error and never calls revoke when refreshToken is missing', async () => {
    await expect(
      controller.logout({} as { refreshToken: string }),
    ).resolves.toBeUndefined();

    expect(refreshTokenService.revoke).not.toHaveBeenCalled();
  });

  it('resolves without error and never calls revoke when refreshToken is empty', async () => {
    await expect(
      controller.logout({ refreshToken: '' }),
    ).resolves.toBeUndefined();

    expect(refreshTokenService.revoke).not.toHaveBeenCalled();
  });

  it('resolves without error even when revoke finds no matching token', async () => {
    // revoke() is idempotent by design — the controller doesn't (and can't)
    // distinguish "revoked" from "nothing matched" (RefreshTokenService.revoke
    // never reveals it), so the response is identical either way.
    await expect(
      controller.logout({ refreshToken: 'unknown-token' }),
    ).resolves.toBeUndefined();
  });

  it('resolves without error when the body itself is missing', async () => {
    await expect(
      controller.logout(undefined as unknown as { refreshToken: string }),
    ).resolves.toBeUndefined();

    expect(refreshTokenService.revoke).not.toHaveBeenCalled();
  });

  const nonStringCases: Array<[string, unknown]> = [
    ['a number', 12345],
    ['null', null],
    ['an object', { foo: 'bar' }],
    ['an array', ['a', 'b']],
  ];

  it.each(nonStringCases)(
    'resolves without error and never calls revoke when refreshToken is %s',
    async (_description, refreshToken) => {
      await expect(
        controller.logout({ refreshToken } as unknown as {
          refreshToken: string;
        }),
      ).resolves.toBeUndefined();

      expect(refreshTokenService.revoke).not.toHaveBeenCalled();
    },
  );

  it('resolves without error and never calls revoke when refreshToken exceeds the length cap', async () => {
    await expect(
      controller.logout({ refreshToken: 'a'.repeat(513) }),
    ).resolves.toBeUndefined();

    expect(refreshTokenService.revoke).not.toHaveBeenCalled();
  });
});
