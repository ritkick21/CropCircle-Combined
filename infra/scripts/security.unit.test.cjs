const { fileMatchesType } = require('../../apps/api/dist/config/file-content');
const { validateEnvironment } = require('../../apps/api/dist/config/environment');

test('attachment type requires a matching signature', () => {
  expect(fileMatchesType(Buffer.from([255, 216, 255, 224]), 'image/jpeg')).toBe(true);
  expect(fileMatchesType(Buffer.from('RIFFabcdWEBP'), 'image/webp')).toBe(true);
  expect(fileMatchesType(Buffer.from('%PDF-1.7'), 'application/pdf')).toBe(true);
  expect(fileMatchesType(Buffer.from('invalid png'), 'image/png')).toBe(false);
  expect(fileMatchesType(Buffer.from([255, 216, 255, 224]), 'image/svg+xml')).toBe(false);
});

test('production refuses missing internal authentication and insecure browser origins', () => {
  const production = {
    NODE_ENV: 'production', DATABASE_URL: 'postgresql://localhost/demo',
    REDIS_URL: 'rediss://localhost/0', WEB_ORIGIN: 'https://demo.example.invalid',
    AUTH_JWT_SECRET: 'x'.repeat(43), AUTH_SMTP_HOST: 'smtp.example.invalid',
    AUTH_MAIL_FROM: 'demo@example.invalid',
  };
  expect(() => validateEnvironment(production)).toThrow('ML_SERVICE_KEY');
  production.ML_SERVICE_KEY = 'y'.repeat(43);
  expect(() => validateEnvironment(production)).not.toThrow();
  expect(() => validateEnvironment({ ...production, WEB_ORIGIN: 'http://localhost' })).toThrow('HTTPS');
});
