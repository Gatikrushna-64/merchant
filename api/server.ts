import { app } from './app';
import { appConfig as config } from './config';
import { initDatabase } from './db';

async function bootstrap() {
  try {
    await initDatabase();
    console.log('Database initialized successfully.');

    app.listen(config.port, () => {
      console.log(`Merchant Backend API listening on port ${config.port} (${config.nodeEnv})`);
    });
  } catch (err) {
    console.error('Failed to start application:', err);
    process.exit(1);
  }
}

bootstrap();

