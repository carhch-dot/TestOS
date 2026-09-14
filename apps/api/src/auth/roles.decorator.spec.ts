import 'reflect-metadata';
import { UsuarioRole } from '@prisma/client';
import { ROLES_KEY, Roles } from './roles.decorator';

describe('Roles decorator', () => {
  it('attaches the given roles as metadata on the decorated method', () => {
    const handler = function exampleHandler(): void {};
    const descriptor: PropertyDescriptor = { value: handler };

    Roles(UsuarioRole.MANAGER, UsuarioRole.ADMINISTRATOR)(
      {},
      'handler',
      descriptor,
    );

    expect(Reflect.getMetadata(ROLES_KEY, descriptor.value as object)).toEqual([
      UsuarioRole.MANAGER,
      UsuarioRole.ADMINISTRATOR,
    ]);
  });

  it('supports being applied with no roles at all', () => {
    const handler = function anotherHandler(): void {};
    const descriptor: PropertyDescriptor = { value: handler };

    Roles()({}, 'handler', descriptor);

    expect(Reflect.getMetadata(ROLES_KEY, descriptor.value as object)).toEqual(
      [],
    );
  });
});
