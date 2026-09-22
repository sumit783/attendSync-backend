const prisma = require('../prisma/client');
const jwt = require('jsonwebtoken');

let isTableInitialized = false;

// Ensure ActivityLog table exists in MySQL
const initTable = async () => {
    if (isTableInitialized) return;
    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS ActivityLog (
                id VARCHAR(191) NOT NULL PRIMARY KEY,
                method VARCHAR(20) NOT NULL,
                url VARCHAR(500) NOT NULL,
                route VARCHAR(255) NULL,
                statusCode INT NOT NULL,
                ipAddress VARCHAR(100) NULL,
                userAgent TEXT NULL,
                userId VARCHAR(100) NULL,
                userName VARCHAR(150) NULL,
                userEmail VARCHAR(150) NULL,
                role VARCHAR(50) NULL,
                organizationCode VARCHAR(50) NULL,
                organizationId VARCHAR(100) NULL,
                requestBody LONGTEXT NULL,
                responseTimeMs INT NULL,
                createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                INDEX idx_activity_method (method),
                INDEX idx_activity_status (statusCode),
                INDEX idx_activity_org (organizationCode),
                INDEX idx_activity_created (createdAt)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        isTableInitialized = true;
    } catch (err) {
        console.warn('ActivityLog table init note:', err.message);
    }
};

// Auto-run init
initTable();

// Sanitize sensitive keys and bulky base64 data
const sanitizeBody = (body) => {
    if (!body || typeof body !== 'object') return null;
    try {
        const sensitiveKeys = ['password', 'confirmPassword', 'newPassword', 'currentPassword', 'oldPassword', 'otp', 'token', 'jwt', 'secret'];
        const copy = JSON.parse(JSON.stringify(body));

        const scrub = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            for (const key of Object.keys(obj)) {
                if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
                    obj[key] = '********';
                } else if (typeof obj[key] === 'string') {
                    // Truncate base64 strings or images longer than 300 chars
                    if (obj[key].startsWith('data:image') || obj[key].length > 300) {
                        obj[key] = obj[key].slice(0, 100) + '... [TRUNCATED]';
                    }
                } else if (typeof obj[key] === 'object') {
                    scrub(obj[key]);
                }
            }
        };

        scrub(copy);
        const str = JSON.stringify(copy);
        return str.length > 5000 ? str.slice(0, 5000) + '... [TRUNCATED]' : str;
    } catch (e) {
        return null;
    }
};

const logActivity = async (data) => {
    try {
        await initTable();
        const id = require('crypto').randomUUID();
        const {
            method,
            url,
            route,
            statusCode,
            ipAddress,
            userAgent,
            userId,
            userName,
            userEmail,
            role,
            organizationCode,
            organizationId,
            requestBody,
            responseTimeMs
        } = data;

        const bodyStr = typeof requestBody === 'string' ? requestBody : sanitizeBody(requestBody);

        await prisma.$executeRawUnsafe(
            `INSERT INTO ActivityLog 
            (id, method, url, route, statusCode, ipAddress, userAgent, userId, userName, userEmail, role, organizationCode, organizationId, requestBody, responseTimeMs, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
            id,
            method || 'UNKNOWN',
            (url || '').slice(0, 500),
            (route || '').slice(0, 255),
            Number(statusCode) || 200,
            ipAddress || null,
            userAgent || null,
            userId || null,
            userName || null,
            userEmail || null,
            role || null,
            organizationCode || null,
            organizationId || null,
            bodyStr || null,
            responseTimeMs || null
        );
    } catch (error) {
        // Logging should never throw or break request flow
        console.error('Error recording activity log:', error.message);
    }
};

const getActivityLogs = async ({
    page = 1,
    limit = 20,
    method = 'ALL',
    search = '',
    statusGroup = 'ALL',
    startDate,
    endDate,
    organizationCode
}) => {
    await initTable();
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const params = [];

    if (method && method !== 'ALL') {
        conditions.push('method = ?');
        params.push(method.toUpperCase());
    }

    if (statusGroup && statusGroup !== 'ALL') {
        if (statusGroup === '2xx' || statusGroup === 'SUCCESS') {
            conditions.push('statusCode >= 200 AND statusCode < 300');
        } else if (statusGroup === '3xx') {
            conditions.push('statusCode >= 300 AND statusCode < 400');
        } else if (statusGroup === '4xx' || statusGroup === 'CLIENT_ERROR') {
            conditions.push('statusCode >= 400 AND statusCode < 500');
        } else if (statusGroup === '5xx' || statusGroup === 'SERVER_ERROR') {
            conditions.push('statusCode >= 500');
        } else if (!isNaN(Number(statusGroup))) {
            conditions.push('statusCode = ?');
            params.push(Number(statusGroup));
        }
    }

    if (search && search.trim()) {
        const s = `%${search.trim()}%`;
        conditions.push('(url LIKE ? OR route LIKE ? OR userName LIKE ? OR userEmail LIKE ? OR ipAddress LIKE ? OR organizationCode LIKE ?)');
        params.push(s, s, s, s, s, s);
    }

    if (startDate) {
        conditions.push('createdAt >= ?');
        params.push(new Date(startDate));
    }

    if (endDate) {
        conditions.push('createdAt <= ?');
        params.push(new Date(endDate));
    }

    if (organizationCode) {
        conditions.push('organizationCode = ?');
        params.push(organizationCode);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countResult = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) as total FROM ActivityLog ${whereClause}`,
        ...params
    );
    const total = Number(countResult[0]?.total || 0);

    // Fetch logs
    const logs = await prisma.$queryRawUnsafe(
        `SELECT * FROM ActivityLog ${whereClause} ORDER BY createdAt DESC LIMIT ${limitNum} OFFSET ${offset}`,
        ...params
    );

    // Summary stats
    const statsResult = await prisma.$queryRawUnsafe(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN method = 'POST' THEN 1 ELSE 0 END) as postCount,
            SUM(CASE WHEN method = 'PUT' THEN 1 ELSE 0 END) as putCount,
            SUM(CASE WHEN method = 'PATCH' THEN 1 ELSE 0 END) as patchCount,
            SUM(CASE WHEN method = 'DELETE' THEN 1 ELSE 0 END) as deleteCount,
            SUM(CASE WHEN statusCode >= 400 THEN 1 ELSE 0 END) as errorCount
        FROM ActivityLog
    `);

    const statsRow = statsResult[0] || {};

    return {
        logs,
        pagination: {
            total,
            totalPages: Math.ceil(total / limitNum) || 1,
            currentPage: pageNum,
            limit: limitNum
        },
        stats: {
            total: Number(statsRow.total || 0),
            postCount: Number(statsRow.postCount || 0),
            putCount: Number(statsRow.putCount || 0),
            patchCount: Number(statsRow.patchCount || 0),
            deleteCount: Number(statsRow.deleteCount || 0),
            errorCount: Number(statsRow.errorCount || 0)
        }
    };
};

const clearActivityLogs = async ({ olderThanDays = null }) => {
    await initTable();
    if (olderThanDays && !isNaN(Number(olderThanDays))) {
        const dateThreshold = new Date(Date.now() - Number(olderThanDays) * 24 * 60 * 60 * 1000);
        await prisma.$executeRawUnsafe(`DELETE FROM ActivityLog WHERE createdAt < ?`, dateThreshold);
        return { message: `Activity logs older than ${olderThanDays} days cleared.` };
    } else {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE ActivityLog`);
        return { message: 'All activity logs cleared successfully.' };
    }
};

module.exports = {
    initTable,
    logActivity,
    sanitizeBody,
    getActivityLogs,
    clearActivityLogs
};
