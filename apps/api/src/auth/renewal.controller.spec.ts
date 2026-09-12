import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { RenewalController } from './renewal.controller';
import { RenewalService, REFRESH_FAILED_MESSAGE } from './renewal.service';

describe('RenewalController', () => {
  let renewalService: { renew: jest.Mock };
  let controller: RenewalController;

  beforeEach(async () => {
    renewalService = {
      renew: jest
        .fn()
        .mockResolvedValue({ accessToken: 'a', refreshToken: 'b' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [RenewalController],
      providers: [{ provide: RenewalService, useValue: renewalService }],
    }).compile();

    controller = moduleRef.get(RenewalController);
  });

  it('delegates to RenewalService and returns its result', async () => {
    const result = await controller.refresh({ refreshToken: 'raw-token' });

    expect(renewalService.renew).toHaveBeenCalledWith('raw-token');
    expect(result).toEqual({ accessToken: 'a', refreshToken: 'b' });
  });

  it('rejects with the generic message when refreshToken is missing, never calling the service', async () => {
    await expect(
      controller.refresh({} as { refreshToken: string }),
    ).rejects.toThrow(REFRESH_FAILED_MESSAGE);

    expect(renewalService.renew).not.toHaveBeenCalled();
  });

  it('rejects with the generic message when refreshToken is empty', async () => {
    await expect(
      controller.refresh({ refreshToken: '' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(renewalService.renew).not.toHaveBeenCalled();
  });

  it('rejects with the generic message when the body itself is missing', async () => {
    await expect(
      controller.refresh(undefined as unknown as { refreshToken: string }),
    ).rejects.toThrow(REFRESH_FAILED_MESSAGE);
    expect(renewalService.renew).not.toHaveBeenCalled();
  });

  const nonStringCases: Array<[string, unknown]> = [
    ['a number', 12345],
    ['null', null],
    ['an object', { foo: 'bar' }],
    ['an array', ['a', 'b']],
  ];

  it.each(nonStringCases)(
    'rejects with the generic message when refreshToken is %s',
    async (_description, refreshToken) => {
      await expect(
        controller.refresh({ refreshToken } as unknown as {
          refreshToken: string;
        }),
      ).rejects.toThrow(REFRESH_FAILED_MESSAGE);
      expect(renewalService.renew).not.toHaveBeenCalled();
    },
  );

  it('rejects with the generic message when refreshToken exceeds the length cap', async () => {
    await expect(
      controller.refresh({ refreshToken: 'a'.repeat(513) }),
    ).rejects.toThrow(REFRESH_FAILED_MESSAGE);
    expect(renewalService.renew).not.toHaveBeenCalled();
  });

  it('propagates the exact exception thrown by RenewalService', async () => {
    renewalService.renew.mockRejectedValue(
      new UnauthorizedException(REFRESH_FAILED_MESSAGE),
    );

    await expect(
      controller.refresh({ refreshToken: 'raw-token' }),
    ).rejects.toThrow(REFRESH_FAILED_MESSAGE);
  });
});
