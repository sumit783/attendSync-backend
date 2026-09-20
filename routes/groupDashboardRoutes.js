const express = require('express');
const router = express.Router();
const prisma = require('../prisma/client');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const moment = require('moment-timezone');

// Middleware to gather all organizations accessible to this super admin
const requireGroupAccess = async (req, res, next) => {
    if (!req.adminId) {
        return res.status(401).send({ message: 'Unauthorized. Admin context missing.' });
    }

    try {
        // Find all roles for this admin that are SUPER_ADMIN
        const superRoles = await prisma.adminRole.findMany({
            where: {
                adminId: req.adminId,
                role: 'SUPER_ADMIN'
            }
        });

        if (!superRoles || superRoles.length === 0) {
            return res.status(403).send({ message: 'Forbidden. You do not have group admin privileges.' });
        }

        const orgIds = [];
        
        for (const role of superRoles) {
            if (role.organizationId) {
                orgIds.push(role.organizationId);
                // Get all children of this organization
                const children = await prisma.organization.findMany({
                    where: { parentId: role.organizationId },
                    select: { id: true }
                });
                children.forEach(child => orgIds.push(child.id));
            } else {
                // If organizationId is null, they might be a global super admin (access to all)
                // Let's just fetch all orgs in this case
                const allOrgs = await prisma.organization.findMany({ select: { id: true } });
                req.groupOrgIds = allOrgs.map(o => o.id);
                return next();
            }
        }

        // Remove duplicates
        req.groupOrgIds = [...new Set(orgIds)];

        if (req.groupOrgIds.length === 0) {
            return res.status(403).send({ message: 'No organizations found for this admin.' });
        }

        next();
    } catch (error) {
        console.error('Error in requireGroupAccess:', error);
        res.status(500).send({ message: 'Internal Server Error' });
    }
};

router.use(authenticateAdmin);
router.use(requireGroupAccess);

// ==========================================
// 1. STATS (KPIs)
// ==========================================
router.get('/stats', async (req, res) => {
    try {
        const orgIds = req.groupOrgIds;
        
        // Managed Companies
        const managedCompanies = orgIds.length;

        // Total Workforce
        const totalWorkforce = await prisma.employee.count({
            where: { organizationId: { in: orgIds }, status: 'active' }
        });

        // Present Today
        const today = moment().tz('Asia/Kolkata').startOf('day').toDate();
        const endOfToday = moment().tz('Asia/Kolkata').endOf('day').toDate();
        
        const presentToday = await prisma.attendance.count({
            where: {
                employee: { organizationId: { in: orgIds } },
                date: { gte: today, lte: endOfToday },
                finalRemark: { in: ['Present', 'Half Day', 'Clocked In', 'Regularized', 'Left Early'] }
            }
        });

        // On Leave Today
        const onLeaveToday = await prisma.leave.count({
            where: {
                employee: { organizationId: { in: orgIds } },
                status: 'Approved',
                startDate: { lte: endOfToday },
                endDate: { gte: today }
            }
        });

        res.status(200).send({
            managedCompanies,
            totalWorkforce,
            presentToday,
            onLeaveToday
        });

    } catch (error) {
        console.error('Error fetching group stats:', error);
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
});

// ==========================================
// 2. ATTENDANCE BY COMPANY
// ==========================================
router.get('/attendance-by-company', async (req, res) => {
    try {
        const orgIds = req.groupOrgIds;
        const today = moment().tz('Asia/Kolkata').startOf('day').toDate();
        const endOfToday = moment().tz('Asia/Kolkata').endOf('day').toDate();

        const orgs = await prisma.organization.findMany({
            where: { id: { in: orgIds } },
            select: { id: true, organizationName: true, employeeCount: true }
        });

        const attendanceData = [];

        for (const org of orgs) {
            const total = org.employeeCount;

            const presentCount = await prisma.attendance.count({
                where: {
                    employee: { organizationId: org.id },
                    date: { gte: today, lte: endOfToday },
                    finalRemark: { in: ['Present', 'Half Day', 'Clocked In', 'Regularized', 'Left Early'] }
                }
            });

            const leaveCount = await prisma.leave.count({
                where: {
                    employee: { organizationId: org.id },
                    status: 'Approved',
                    startDate: { lte: endOfToday },
                    endDate: { gte: today }
                }
            });

            const absentCount = Math.max(0, total - presentCount - leaveCount);

            attendanceData.push({
                name: org.organizationName,
                total,
                present: presentCount,
                absent: absentCount,
                onLeave: leaveCount
            });
        }

        // Sort by total employees descending
        attendanceData.sort((a, b) => b.total - a.total);

        res.status(200).send(attendanceData);
    } catch (error) {
        console.error('Error fetching attendance by company:', error);
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
});

// ==========================================
// 3. DEPARTMENT DISTRIBUTION
// ==========================================
router.get('/department-distribution', async (req, res) => {
    try {
        const orgIds = req.groupOrgIds;

        const depts = await prisma.department.findMany({
            where: { organizationId: { in: orgIds } },
            include: { employees: { where: { status: 'active' }, select: { id: true } } }
        });

        // Group by department name (across companies, many companies might have "Engineering")
        const deptMap = {};
        let totalAssigned = 0;

        for (const d of depts) {
            const count = d.employees.length;
            if (count > 0) {
                const name = d.name;
                if (!deptMap[name]) deptMap[name] = 0;
                deptMap[name] += count;
                totalAssigned += count;
            }
        }

        const data = Object.keys(deptMap).map(name => ({
            name,
            value: totalAssigned > 0 ? Math.round((deptMap[name] / totalAssigned) * 100) : 0,
            count: deptMap[name]
        }));

        // Sort by value desc
        data.sort((a, b) => b.value - a.value);

        res.status(200).send(data);
    } catch (error) {
        console.error('Error fetching department distribution:', error);
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
});

// ==========================================
// 4. EXPENSE TRENDS
// ==========================================
router.get('/expense-trends', async (req, res) => {
    try {
        const orgIds = req.groupOrgIds;
        const now = moment().tz('Asia/Kolkata');
        
        // Last 6 months range
        const rangeStart = now.clone().subtract(5, 'months').startOf('month').toDate();
        const rangeEnd = now.clone().endOf('month').toDate();

        // Fetch top 5 orgs by employee count to simplify
        const topOrgs = await prisma.organization.findMany({
            where: { id: { in: orgIds } },
            orderBy: { employeeCount: 'desc' },
            take: 5,
            select: { id: true, organizationName: true, organizationCode: true }
        });

        const orgCodes = topOrgs.map(o => o.organizationCode).filter(Boolean);

        const expenses = await prisma.expense.findMany({
            where: {
                organizationCode: { in: orgCodes },
                status: { in: ['Approved', 'Paid'] },
                createdAt: { gte: rangeStart, lte: rangeEnd }
            }
        });

        // Build data structure
        const trends = [];
        for (let i = 5; i >= 0; i--) {
            const m = now.clone().subtract(i, 'months');
            const mKey = m.format('YYYY-MM');
            const row = { month: m.format('MMM') };
            
            // Initialize org columns
            for (const org of topOrgs) {
                // Remove spaces and special chars for valid data keys in frontend (or use name directly)
                // Let's use name directly but ensure frontend matches
                row[org.organizationName] = 0;
            }

            // Fill data
            for (const exp of expenses) {
                if (moment(exp.createdAt).format('YYYY-MM') === mKey) {
                    const orgName = topOrgs.find(o => o.organizationCode === exp.organizationCode)?.organizationName;
                    if (orgName) {
                        row[orgName] += exp.amount;
                    }
                }
            }
            trends.push(row);
        }

        res.status(200).send({ trends, orgs: topOrgs.map(o => o.organizationName) });
    } catch (error) {
        console.error('Error fetching expense trends:', error);
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
});

// ==========================================
// 5. LEAVE TRENDS
// ==========================================
router.get('/leave-trends', async (req, res) => {
    try {
        const orgIds = req.groupOrgIds;
        const now = moment().tz('Asia/Kolkata');
        
        const rangeStart = now.clone().subtract(5, 'months').startOf('month').toDate();
        const rangeEnd = now.clone().endOf('month').toDate();

        const leaves = await prisma.leave.findMany({
            where: {
                employee: { organizationId: { in: orgIds } },
                status: 'Approved',
                startDate: { gte: rangeStart, lte: rangeEnd }
            }
        });

        const trends = [];
        for (let i = 5; i >= 0; i--) {
            const m = now.clone().subtract(i, 'months');
            const mKey = m.format('YYYY-MM');
            
            let totalLeaves = 0;
            for (const leave of leaves) {
                if (moment(leave.startDate).format('YYYY-MM') === mKey) {
                    // Count number of days
                    const start = moment(leave.startDate);
                    const end = moment(leave.endDate);
                    totalLeaves += Math.max(1, end.diff(start, 'days') + 1);
                }
            }

            trends.push({
                month: m.format('MMM'),
                totalLeaves
            });
        }

        res.status(200).send(trends);
    } catch (error) {
        console.error('Error fetching leave trends:', error);
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
});

// ==========================================
// 6. APPROVALS
// ==========================================
router.get('/approvals', async (req, res) => {
    try {
        const orgIds = req.groupOrgIds;
        const orgCodesData = await prisma.organization.findMany({
            where: { id: { in: orgIds } },
            select: { organizationCode: true, organizationName: true }
        });
        const orgCodes = orgCodesData.map(o => o.organizationCode).filter(Boolean);
        const codeToName = {};
        orgCodesData.forEach(o => { codeToName[o.organizationCode] = o.organizationName; });

        // Fetch pending leaves
        const leaves = await prisma.leave.findMany({
            where: { employee: { organizationId: { in: orgIds } }, status: 'Pending' },
            include: { employee: { select: { employeeName: true, organizationId: true } } },
            take: 5,
            orderBy: { createdAt: 'desc' }
        });

        // Fetch pending expenses
        const expenses = await prisma.expense.findMany({
            where: { organizationCode: { in: orgCodes }, status: 'Pending' },
            include: { employee: { select: { employeeName: true } } },
            take: 5,
            orderBy: { createdAt: 'desc' }
        });

        let approvals = [];
        
        leaves.forEach(l => {
            const orgName = orgCodesData.find(o => o.id === l.employee.organizationId)?.organizationName || 'Unknown';
            approvals.push({
                id: `#L-${l.id.substring(0, 4)}`,
                company: orgName,
                subject: `${l.leaveType} - ${l.employee.employeeName}`,
                status: l.status,
                date: l.createdAt
            });
        });

        expenses.forEach(e => {
            approvals.push({
                id: `#E-${e.id.substring(0, 4)}`,
                company: codeToName[e.organizationCode] || 'Unknown',
                subject: `Expense Claim - ${e.employee.employeeName}`,
                status: e.status,
                date: e.createdAt
            });
        });

        approvals.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        res.status(200).send(approvals.slice(0, 8));
    } catch (error) {
        console.error('Error fetching approvals:', error);
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
});

// ==========================================
// 7. ALERTS
// ==========================================
router.get('/alerts', async (req, res) => {
    try {
        const orgIds = req.groupOrgIds;
        const alerts = [];
        
        // 1. High absenteeism alert
        const today = moment().tz('Asia/Kolkata').startOf('day').toDate();
        const endOfToday = moment().tz('Asia/Kolkata').endOf('day').toDate();
        const orgs = await prisma.organization.findMany({
            where: { id: { in: orgIds } },
            select: { id: true, organizationName: true, employeeCount: true }
        });

        for (const org of orgs) {
            if (org.employeeCount > 0) {
                const presentCount = await prisma.attendance.count({
                    where: { employee: { organizationId: org.id }, date: { gte: today, lte: endOfToday }, finalRemark: { in: ['Present', 'Half Day', 'Clocked In', 'Regularized', 'Left Early'] } }
                });
                const leaveCount = await prisma.leave.count({
                    where: { employee: { organizationId: org.id }, status: 'Approved', startDate: { lte: endOfToday }, endDate: { gte: today } }
                });
                const absentCount = Math.max(0, org.employeeCount - presentCount - leaveCount);
                const absentRate = (absentCount / org.employeeCount) * 100;

                if (absentRate >= 15) {
                    alerts.push({
                        id: `alt-abs-${org.id}`,
                        text: `High absenteeism (${Math.round(absentRate)}%) at ${org.organizationName} today.`,
                        time: "Today",
                        type: 'warning'
                    });
                }
            }
        }

        // 2. Pending approvals volume alert
        const pendingLeavesCount = await prisma.leave.count({
            where: { employee: { organizationId: { in: orgIds } }, status: 'Pending' }
        });
        
        if (pendingLeavesCount > 20) {
            alerts.push({
                id: `alt-lvs`,
                text: `There are ${pendingLeavesCount} pending leave requests across the group requiring attention.`,
                time: "Today",
                type: 'warning'
            });
        }

        if (alerts.length === 0) {
            alerts.push({
                id: 'alt-ok',
                text: "All operations are running smoothly across all companies.",
                time: "Just now",
                type: 'success'
            });
        }

        res.status(200).send(alerts);
    } catch (error) {
        console.error('Error fetching alerts:', error);
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
});

module.exports = router;
