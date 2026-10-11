import { buildApp } from './app.js';

const app = await buildApp();
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  app.log.error({ port: process.env.PORT }, 'Invalid PORT');
  process.exitCode = 1;
} else {
  try {
    await app.listen({ host: '0.0.0.0', port });
    app.log.info({ port }, 'Application started');
  } catch (error) {
    app.log.error({ err: error }, 'Application startup failed');
    process.exitCode = 1;
  }
}
