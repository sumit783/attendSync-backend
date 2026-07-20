const cron = require('node-cron');
const prisma = require('../prisma/client');

// Run daily at midnight to delete old notifications
cron.schedule('0 0 * * *', async () => {
  try {
    console.log('Checking for old notifications to delete...');
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 45); // 1.5 months ≈ 45 days

    const result = await prisma.notification.deleteMany({
        where: {
            createdAt: { lt: cutoffDate }
        }
    });

    console.log(`Deleted ${result.count} old notifications.`);
  } catch (error) {
    console.error('Error while deleting old notifications:', error);
  }
});
