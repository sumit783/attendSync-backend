const { PrismaClient } = require('@prisma/client');

// Singleton: reuse across hot-reloads in development
const globalForPrisma = global;

const prisma =
  globalForPrisma._prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV === 'development') {
  // Log slow queries (>500ms) to console
  prisma.$on('query', (e) => {
    if (e.duration > 500) {
      console.warn(`[SLOW QUERY ${e.duration}ms] ${e.query}`);
    }
  });
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma._prisma = prisma;
}

module.exports = prisma;
