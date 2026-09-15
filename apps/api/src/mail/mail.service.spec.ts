import { MailService } from './mail.service';

const sendMailMock = jest.fn();
const closeMock = jest.fn();
const createTransportMock = jest.fn(() => ({
  sendMail: sendMailMock,
  close: closeMock,
}));

jest.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransportMock(...args),
}));

describe('MailService', () => {
  const ORIGINAL_ENV = process.env;
  let service: MailService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'pass',
      MAIL_FROM: 'no-reply@example.com',
      MAIL_TIMEOUT_MS: '50',
    };
    service = new MailService();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('sends an email via the configured SMTP transport', async () => {
    sendMailMock.mockResolvedValue(undefined);

    await service.send('to@example.com', 'Subject', 'Body');

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        auth: { user: 'user', pass: 'pass' },
      }),
    );
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'no-reply@example.com',
      to: 'to@example.com',
      subject: 'Subject',
      text: 'Body',
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('swallows a send failure without throwing, and still closes the transporter', async () => {
    sendMailMock.mockRejectedValue(new Error('connection refused'));

    await expect(
      service.send('to@example.com', 'Subject', 'Body'),
    ).resolves.toBeUndefined();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('swallows a timeout without throwing', async () => {
    // A sendMail call that never resolves: MAIL_TIMEOUT_MS=50 above should
    // still make `send` resolve promptly instead of hanging.
    sendMailMock.mockReturnValue(new Promise(() => {}));

    await expect(
      service.send('to@example.com', 'Subject', 'Body'),
    ).resolves.toBeUndefined();
  });

  it('skips sending and never opens a connection when SMTP_HOST is unset', async () => {
    delete process.env.SMTP_HOST;

    await expect(
      service.send('to@example.com', 'Subject', 'Body'),
    ).resolves.toBeUndefined();
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
