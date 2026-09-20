const express = require("express");
const router = express.Router();
const prisma = require("../prisma/client");
const authenticateAdmin = require("../middleware/authenticateAdmin");
const moment = require("moment-timezone");

const requireGroupAccess = async (req, res, next) => {
    if (!req.adminId) {
        return res.status(401).send({ message: "Unauthorized. Admin context missing." });
    }
    try {
        const roles = await prisma.adminRole.findMany({
            where: { adminId: req.adminId }
        });
        if (!roles || roles.length === 0) {
            return res.status(403).send({ message: "Forbidden. You do not have any privileges." });
        }

        let hasGlobalAccess = false;
        const orgIds = [];

        for (const role of roles) {
            if (role.role === "SUPER_ADMIN" && !role.organizationId) {
                hasGlobalAccess = true;
                break;
            }
            if (role.organizationId) {
                orgIds.push(role.organizationId);
                const children = await prisma.organization.findMany({
                    where: { parentId: role.organizationId }, select: { id: true }
                });
                children.forEach(child => orgIds.push(child.id));
            }
        }

        if (hasGlobalAccess) {
            const allOrgs = await prisma.organization.findMany({ select: { id: true } });
            req.groupOrgIds = allOrgs.map(o => o.id);
            return next();
        }

        req.groupOrgIds = [...new Set(orgIds)];
        if (req.groupOrgIds.length === 0) {
            return res.status(403).send({ message: "No organizations found for this admin." });
        }
        next();
    } catch (error) {
        console.error("Error in requireGroupAccess:", error);
        res.status(500).send({ message: "Internal Server Error" });
    }
};

router.use(authenticateAdmin);
router.use(requireGroupAccess);

// Helper function to resolve target orgs
const getTargetOrgs = async (req) => {
    let { companyId } = req.query;
    let targetOrgIds = req.groupOrgIds;
    
    // If a specific company name or ID is passed
    if (companyId && companyId !== "All Companies") {
        const org = await prisma.organization.findFirst({
            where: {
                OR: [
                    { id: companyId },
                    { organizationName: companyId }
                ]
            }
        });
        if (org && targetOrgIds.includes(org.id)) {
            targetOrgIds = [org.id];
        }
    }
    return targetOrgIds;
};

router.get("/companies", async (req, res) => {
    try {
        const orgs = await prisma.organization.findMany({
            where: { id: { in: req.groupOrgIds } },
            select: { id: true, organizationName: true }
        });
        res.json(orgs);
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
    }
});

// 1. KPIs
router.get("/kpis", async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const targetOrgIds = await getTargetOrgs(req);
        
        const start = startDate ? moment(startDate).tz("Asia/Kolkata").startOf("day").toDate() : moment().tz("Asia/Kolkata").startOf("month").toDate();
        const end = endDate ? moment(endDate).tz("Asia/Kolkata").endOf("day").toDate() : moment().tz("Asia/Kolkata").endOf("month").toDate();

        const totalCompanies = targetOrgIds.length;
        
        const totalEmployees = await prisma.employee.count({
            where: { organizationId: { in: targetOrgIds }, status: "active" }
        });

        const presentCount = await prisma.attendance.count({
            where: {
                employee: { organizationId: { in: targetOrgIds } },
                date: { gte: start, lte: end },
                finalRemark: { in: ["Present", "Half Day", "Clocked In", "Regularized", "Left Early"] }
            }
        });

        const absentCount = await prisma.attendance.count({
            where: {
                employee: { organizationId: { in: targetOrgIds } },
                date: { gte: start, lte: end },
                finalRemark: { in: ["Absent"] }
            }
        });

        let leaveCount = 0;
        const leaves = await prisma.leave.findMany({
            where: {
                employee: { organizationId: { in: targetOrgIds } },
                status: "Approved",
                startDate: { lte: end },
                endDate: { gte: start }
            }
        });
        
        leaves.forEach(l => {
            const lStart = moment.max(moment(start), moment(l.startDate));
            const lEnd = moment.min(moment(end), moment(l.endDate));
            if (lEnd.isSameOrAfter(lStart)) {
                leaveCount += lEnd.diff(lStart, "days") + 1;
            }
        });

        const totalPossibleAttendance = totalEmployees * (moment(end).diff(moment(start), "days") + 1);
        const avgAttendance = totalPossibleAttendance > 0 ? ((presentCount / totalPossibleAttendance) * 100).toFixed(1) : 0;

        res.json({
            totalCompanies,
            totalEmployees,
            avgAttendance: parseFloat(avgAttendance),
            present: presentCount,
            absent: absentCount,
            leave: leaveCount
        });
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
    }
});

// 2. Attendance Trend
router.get("/attendance-trend", async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const targetOrgIds = await getTargetOrgs(req);
        
        const start = startDate ? moment(startDate).tz("Asia/Kolkata").startOf("day") : moment().tz("Asia/Kolkata").startOf("month");
        const end = endDate ? moment(endDate).tz("Asia/Kolkata").endOf("day") : moment().tz("Asia/Kolkata").endOf("month");

        const attendances = await prisma.attendance.findMany({
            where: {
                employee: { organizationId: { in: targetOrgIds } },
                date: { gte: start.toDate(), lte: end.toDate() },
                finalRemark: { in: ["Present", "Half Day", "Clocked In", "Regularized", "Left Early"] }
            }
        });

        const totalEmployees = await prisma.employee.count({
            where: { organizationId: { in: targetOrgIds }, status: "active" }
        });

        const trendMap = {};
        for (let m = start.clone(); m.isSameOrBefore(end); m.add(1, "days")) {
            trendMap[m.format("D MMM")] = { present: 0, date: m.clone() };
        }

        attendances.forEach(a => {
            const key = moment(a.date).tz("Asia/Kolkata").format("D MMM");
            if (trendMap[key]) {
                trendMap[key].present += 1;
            }
        });

        const trend = Object.keys(trendMap).map(key => {
            const rate = totalEmployees > 0 ? (trendMap[key].present / totalEmployees) * 100 : 0;
            return {
                name: key,
                attendance: Math.round(rate),
                timestamp: trendMap[key].date.valueOf()
            };
        });

        trend.sort((a, b) => a.timestamp - b.timestamp);
        
        res.json(trend);
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
    }
});

// 3. Company Rates
router.get("/company-rates", async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const targetOrgIds = req.groupOrgIds; 
        
        const start = startDate ? moment(startDate).tz("Asia/Kolkata").startOf("day").toDate() : moment().tz("Asia/Kolkata").startOf("month").toDate();
        const end = endDate ? moment(endDate).tz("Asia/Kolkata").endOf("day").toDate() : moment().tz("Asia/Kolkata").endOf("month").toDate();

        const orgs = await prisma.organization.findMany({
            where: { id: { in: targetOrgIds } },
            select: { id: true, organizationName: true, employeeCount: true }
        });

        const days = moment(end).diff(moment(start), "days") + 1;
        const rates = [];

        for (const org of orgs) {
            const presentCount = await prisma.attendance.count({
                where: {
                    employee: { organizationId: org.id },
                    date: { gte: start, lte: end },
                    finalRemark: { in: ["Present", "Half Day", "Clocked In", "Regularized", "Left Early"] }
                }
            });

            const maxPossible = org.employeeCount * days;
            const rate = maxPossible > 0 ? (presentCount / maxPossible) * 100 : 0;

            rates.push({
                name: org.organizationName,
                rate: parseFloat(rate.toFixed(1)),
                fill: "#6366f1"
            });
        }

        res.json(rates);
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
    }
});

// 4. Late Early
router.get("/late-early", async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const targetOrgIds = await getTargetOrgs(req);
        
        const start = startDate ? moment(startDate).tz("Asia/Kolkata").startOf("day").toDate() : moment().tz("Asia/Kolkata").startOf("month").toDate();
        const end = endDate ? moment(endDate).tz("Asia/Kolkata").endOf("day").toDate() : moment().tz("Asia/Kolkata").endOf("month").toDate();

        const attendances = await prisma.attendance.findMany({
            where: {
                employee: { organizationId: { in: targetOrgIds } },
                date: { gte: start, lte: end }
            }
        });

        const dayMap = { "Mon": { late: 0, early: 0 }, "Tue": { late: 0, early: 0 }, "Wed": { late: 0, early: 0 }, "Thu": { late: 0, early: 0 }, "Fri": { late: 0, early: 0 }, "Sat": { late: 0, early: 0 }, "Sun": { late: 0, early: 0 } };

        attendances.forEach(a => {
            const dayStr = moment(a.date).tz("Asia/Kolkata").format("ddd");
            if (dayMap[dayStr]) {
                if (a.isLate) dayMap[dayStr].late += 1;
                if (a.isEarlyOut) dayMap[dayStr].early += 1;
            }
        });

        const result = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => ({
            day,
            late: dayMap[day].late,
            early: dayMap[day].early
        }));

        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
    }
});

// 5. Leave Summary
router.get("/leave-summary", async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const targetOrgIds = await getTargetOrgs(req);
        
        const start = startDate ? moment(startDate).tz("Asia/Kolkata").startOf("day").toDate() : moment().tz("Asia/Kolkata").startOf("month").toDate();
        const end = endDate ? moment(endDate).tz("Asia/Kolkata").endOf("day").toDate() : moment().tz("Asia/Kolkata").endOf("month").toDate();

        const leaves = await prisma.leave.findMany({
            where: {
                employee: { organizationId: { in: targetOrgIds } },
                status: "Approved",
                startDate: { lte: end },
                endDate: { gte: start }
            }
        });

        const counts = {};
        leaves.forEach(l => {
            if (!counts[l.leaveType]) counts[l.leaveType] = 0;
            const lStart = moment.max(moment(start), moment(l.startDate));
            const lEnd = moment.min(moment(end), moment(l.endDate));
            if (lEnd.isSameOrAfter(lStart)) {
                counts[l.leaveType] += lEnd.diff(lStart, "days") + 1;
            }
        });

        const colors = ["#f87171", "#fbbf24", "#34d399", "#60a5fa", "#a78bfa"];
        const result = Object.keys(counts).map((type, i) => ({
            type,
            count: counts[type],
            color: colors[i % colors.length]
        }));

        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
    }
});

// 6. Export Attendance CSV
router.get("/export-attendance", async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const targetOrgIds = await getTargetOrgs(req);

        const start = startDate
            ? moment(startDate).tz("Asia/Kolkata").startOf("day").toDate()
            : moment().tz("Asia/Kolkata").startOf("month").toDate();
        const end = endDate
            ? moment(endDate).tz("Asia/Kolkata").endOf("day").toDate()
            : moment().tz("Asia/Kolkata").endOf("month").toDate();

        const attendances = await prisma.attendance.findMany({
            where: {
                employee: { organizationId: { in: targetOrgIds } },
                date: { gte: start, lte: end }
            },
            include: {
                employee: {
                    select: {
                        employeeName: true,
                        employeeEmail: true,
                        organizationCode: true,
                        organization: { select: { organizationName: true } },
                        department: { select: { name: true } }
                    }
                }
            },
            orderBy: { date: 'asc' }
        });

        // Build CSV
        const headers = [
            'Employee Name',
            'Email',
            'Org Code',
            'Organization',
            'Department',
            'Date',
            'Clock In',
            'Clock Out',
            'Status',
            'Is Late',
            'Early Out',
            'Work Hours'
        ];

        const rows = attendances.map(a => {
            const emp = a.employee;
            const dateStr = moment(a.date).tz("Asia/Kolkata").format("DD-MM-YYYY");
            const clockIn = a.clockIn
                ? moment(a.clockIn).tz("Asia/Kolkata").format("HH:mm:ss")
                : '';
            const clockOut = a.clockOut
                ? moment(a.clockOut).tz("Asia/Kolkata").format("HH:mm:ss")
                : '';

            // Compute work hours
            let workHours = '';
            if (a.clockIn && a.clockOut) {
                const mins = moment(a.clockOut).diff(moment(a.clockIn), 'minutes');
                const h = Math.floor(Math.abs(mins) / 60);
                const m = Math.abs(mins) % 60;
                workHours = `${h}h ${m}m`;
            }

            return [
                `"${emp?.employeeName || ''}"`,
                `"${emp?.employeeEmail || ''}"`,
                `"${emp?.organizationCode || ''}"`,
                `"${emp?.organization?.organizationName || ''}"`,
                `"${emp?.department?.name || 'Unassigned'}"`,
                `"${dateStr}"`,
                `"${clockIn}"`,
                `"${clockOut}"`,
                `"${a.finalRemark || a.remark || ''}"`,
                `"${a.isLate ? 'Yes' : 'No'}"`,
                `"${a.isEarlyOut ? 'Yes' : 'No'}"`,
                `"${workHours}"`
            ].join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');

        const fromStr = moment(start).format("DDMMYYYY");
        const toStr = moment(end).format("DDMMYYYY");

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="attendance_${fromStr}_${toStr}.csv"`);
        res.status(200).send(csv);
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
    }
});

module.exports = router;

