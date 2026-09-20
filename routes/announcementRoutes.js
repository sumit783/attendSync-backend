const express = require('express');
const router = express.Router();
const authenticateAdmin = require('../middleware/authenticateAdmin');
const requireOrganizationAccess = require('../middleware/requireOrganizationAccess');
const authenticateJWT = require('../middleware/authenticateJWT');
const announcementController = require('../controllers/announcementController');

/**
 * @swagger
 * tags:
 *   name: Announcements
 *   description: Announcement management API
 */

/**
 * @swagger
 * /api/announcements:
 *   post:
 *     summary: Create a new announcement (Admin)
 *     tags: [Announcement]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               title:
 *                 type: string
 *               message:
 *                 type: string
 *               canReply:
 *                 type: boolean
 *               targetAll:
 *                 type: boolean
 *               employeeIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Announcement created successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 */
router.post('/', authenticateAdmin, requireOrganizationAccess, announcementController.createAnnouncement);

/**
 * @swagger
 * /api/announcements:
 *   get:
 *     summary: Get all announcements for the organization (Admin)
 *     tags: [Announcement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of items per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search keyword for title or message
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter announcements by creation date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: A list of announcements
 *       401:
 *         description: Unauthorized
 */
router.get('/', authenticateAdmin, requireOrganizationAccess, announcementController.getAnnouncements);

/**
 * @swagger
 * /api/announcements/{id}:
 *   put:
 *     summary: Update an announcement (Admin)
 *     tags: [Announcement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               message:
 *                 type: string
 *               canReply:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Announcement updated successfully
 *       404:
 *         description: Announcement not found
 */
router.put('/:id', authenticateAdmin, requireOrganizationAccess, announcementController.updateAnnouncement);

/**
 * @swagger
 * /api/announcements/{id}:
 *   delete:
 *     summary: Delete an announcement (Admin)
 *     tags: [Announcement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Announcement deleted successfully
 *       404:
 *         description: Announcement not found
 */
router.delete('/:id', authenticateAdmin, requireOrganizationAccess, announcementController.deleteAnnouncement);

/**
 * @swagger
 * /api/announcements/{id}/replies:
 *   get:
 *     summary: Get all replies for an announcement (Admin)
 *     tags: [Announcement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: A list of replies
 *       404:
 *         description: Announcement not found
 */
router.get('/:id/replies', authenticateAdmin, requireOrganizationAccess, announcementController.getAnnouncementReplies);

/**
 * @swagger
 * /api/announcements/{id}/reply:
 *   post:
 *     summary: Reply to an announcement (Employee)
 *     tags: [Announcement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *     responses:
 *       201:
 *         description: Reply submitted successfully
 *       400:
 *         description: Replies disabled or invalid input
 *       403:
 *         description: Forbidden (Not targeted for this announcement)
 *       404:
 *         description: Announcement not found
 */
router.post('/:id/reply', authenticateJWT, announcementController.replyToAnnouncement);

/**
 * @swagger
 * /api/announcements/replies/{replyId}/read:
 *   patch:
 *     summary: Mark a reply as read (Admin)
 *     tags: [Announcement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: replyId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Reply marked as read
 *       404:
 *         description: Reply not found
 */
router.patch('/replies/:replyId/read', authenticateAdmin, requireOrganizationAccess, announcementController.markReplyAsRead);

/**
 * @swagger
 * /api/announcements/{id}/replies/read-all:
 *   patch:
 *     summary: Mark all replies as read for an announcement (Admin)
 *     tags: [Announcement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: All replies marked as read
 *       404:
 *         description: Announcement not found
 */
router.patch('/:id/replies/read-all', authenticateAdmin, requireOrganizationAccess, announcementController.markAllRepliesAsRead);

module.exports = router;

