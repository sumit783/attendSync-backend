const Notification = require('../models/notification');

const createNotification = async (userId, organizationId, message, type, session,target) => {
    try {
        const newNotification = new Notification({
            user: userId,
            organization: organizationId,
            message,
            type,
            target
        });

        const options = session ? { session } : {};
        await newNotification.save(options);
    } catch (error) {
        console.error('Error creating notification:', error);
        throw error; // Ensure error is caught in the transaction
    }
};

module.exports = createNotification;