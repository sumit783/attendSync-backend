const prisma = require('../prisma/client');

const createNotification = async (userId, organizationId, message, type, session, target) => {
    try {
        await prisma.notification.create({
            data: {
                userId: userId,
                organizationId: organizationId,
                message,
                type,
                target
            }
        });
    } catch (error) {
        console.error('Error creating notification:', error);
    }
};

module.exports = createNotification;