const activityLoggerService = require('../services/activityLoggerService');

// Get all activity logs with filtering & pagination
const getActivityLogs = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            method = 'ALL',
            search = '',
            statusGroup = 'ALL',
            startDate,
            endDate,
            organizationCode
        } = req.query;

        const result = await activityLoggerService.getActivityLogs({
            page,
            limit,
            method,
            search,
            statusGroup,
            startDate,
            endDate,
            organizationCode
        });

        res.status(200).json(result);
    } catch (error) {
        console.error('Error in getActivityLogs controller:', error);
        res.status(500).json({ message: 'Failed to fetch activity logs', error: error.message });
    }
};

// Clear activity logs
const clearActivityLogs = async (req, res) => {
    try {
        const { olderThanDays } = req.body;
        const result = await activityLoggerService.clearActivityLogs({ olderThanDays });
        res.status(200).json(result);
    } catch (error) {
        console.error('Error clearing activity logs:', error);
        res.status(500).json({ message: 'Failed to clear activity logs', error: error.message });
    }
};

module.exports = {
    getActivityLogs,
    clearActivityLogs
};
