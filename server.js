const logger = require('./config/logger');

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! Shutting down...');
  console.error(err);
  process.exit(1);
});

const app = require("./app");
const PORT = process.env.PORT;

if (!app || typeof app.listen !== 'function') {
  console.error("app is not an Express instance. Check app.js");
  process.exit(1);
}

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT}`);
});

process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION! Shutting down...');
  logger.error(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});
