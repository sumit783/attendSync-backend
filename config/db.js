const prisma = require('../prisma/client');
const logger = require('./logger');

const connectDB = async () => {
    try {
        await prisma.$connect();
        logger.info('MySQL connected successfully via Prisma');
    } catch (error) {
        logger.error(`Error connecting to MySQL: ${error.message}`);
        process.exit(1); // Exit process with failure
    }
};

module.exports = connectDB;
