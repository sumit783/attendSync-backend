const cron = require('node-cron');
const Organization = require('../models/organization');
const Notification = require('../models/notification'); 

// Run every hour to remove expired QR codes
cron.schedule('*/30 * * * *'
  , async () => {
    console.log('Checking for expired QR codes...');
    await Organization.updateMany(
      { qrCodeExpires: { $lt: new Date() } },
      { $unset: { qrCode: "", qrCodeImage: "", qrCodeExpires: "" } }
    );
    console.log('Expired QR codes removed.');
  });

  // Run daily at midnight
cron.schedule('0 0 * * *', async () => {
  try {
    console.log('Checking for old notifications to delete...');
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 45); // 1.5 months ≈ 45 days

    const result = await Notification.deleteMany({ createdAt: { $lt: cutoffDate } });

    console.log(`Deleted ${result.deletedCount} old notifications.`);
  } catch (error) {
    console.error('Error while deleting old notifications:', error);
  }
});

// cron.schedule('* * * * *', async () => {
//   try {
//     console.log("running");
//     const now = new Date();
//     const expiredOrganizations = await Organization.find({ qrCodeExpiresAt: { $lte: now } });

//     for (const org of expiredOrganizations) {
//       org.scannerCode = null;
//       org.qrCodeExpiresAt = null;
//       org.qrCodeImage = null;
//       await org.save();
//       console.log(`Expired QR code cleaned for organization ${org._id}`);
//     }
//   } catch (error) {
//     console.error('Error during QR cleanup:', error);
//   }
// });
