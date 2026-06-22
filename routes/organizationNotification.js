const express = require('express');
const jwt = require('jsonwebtoken');
const Notification = require('../models/notification');
const authenticateJWT = require('../middleware/authenticateJWT');
const router = express.Router();

// ================== Fetch Organization Notifications ==================
router.get('/organization/notifications', authenticateJWT, async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        console.log('Received Token:', token);

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('Decoded JWT:', decoded);

        const organizationId = decoded.id;
        console.log('Organization ID:', organizationId);

        if (!organizationId) {
            return res.status(400).send({ message: 'Organization ID missing in token' });
        }

        const notifications = await Notification.find({
            organization: organizationId,
            target: 'Organization', // ✅ Filter only org-targeted notifications
            isRead: false
        })
        .populate('user', 'name email')
        .sort({ createdAt: -1 });

        res.status(200).send({ notifications });
    } catch (error) {
        console.error('Error in /organization/notifications:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});

// ================== Mark Notification as Read ==================
router.post('/organization/notifications/read', authenticateJWT, async (req, res) => {
    const { notificationId, notificationIds } = req.body;

    try {
        const ids = notificationIds || (notificationId ? [notificationId] : []);
        
        if (ids.length === 0) {
            return res.status(400).send({ message: 'No notification IDs provided' });
        }

        await Notification.updateMany(
            { _id: { $in: ids } },
            { $set: { isRead: true } }
        );

        res.status(200).send({ message: 'Notifications marked as read' });
    } catch (error) {
        console.error('Error in /organization/notifications/read:', error);
        res.status(500).send({ message: 'Server error', error: error.message }); 
    }
});

module.exports = router;
