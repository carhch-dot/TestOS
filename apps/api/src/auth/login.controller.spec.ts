import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { LoginController, LoginRequestDto } from './login.controller';
import { LoginService } from './login.service';

describe('LoginController', () => {
  let loginService: { login: jest.Mock };
  let controller: LoginController;

  beforeEach(async () => {
    loginService = {
      login: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [LoginController],
      providers: [{ provide: LoginService, useValue: loginService }],
    }).compile();

    controller = moduleRef.get(LoginController);
  });

  it('calls loginService.login with the given credentials on well-formed input', async () => {
    loginService.login.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'b',
    });

    await controller.login({
      email: 'user@example.com',
      password: 'correct-password',
    });

    expect(loginService.login).toHaveBeenCalledWith(
      'user@example.com',
      'correct-password',
    );
  });

  const malformedCases: Array<[string, LoginRequestDto]> = [
    ['missing email', { password: 'x' } as LoginRequestDto],
    ['missing password', { email: 'user@example.com' } as LoginRequestDto],
    [
      'non-string email',
      { email: 123, password: 'x' } as unknown as LoginRequestDto,
    ],
    [
      'non-string password',
      {
        email: 'user@example.com',
        password: 123,
      } as unknown as LoginRequestDto,
    ],
    ['empty email', { email: '', password: 'x' }],
    ['empty password', { email: 'user@example.com', password: '' }],
    [
      'email over 254 characters',
      { email: `${'a'.repeat(255)}@example.com`, password: 'x' },
    ],
    [
      'password over 1024 characters',
      { email: 'user@example.com', password: 'a'.repeat(1025) },
    ],
  ];

  it.each(malformedCases)(
    'throws the generic invalid-credentials error and never calls loginService.login for: %s',
    async (_description, body) => {
      await expect(controller.login(body)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(controller.login(body)).rejects.toThrow(
        'Invalid credentials',
      );
      expect(loginService.login).not.toHaveBeenCalled();
    },
  );
});
