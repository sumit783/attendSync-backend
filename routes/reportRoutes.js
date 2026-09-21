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
            },
            include: {
                sessions: { orderBy: { clockInTime: 'asc' } }
            }
        });

        const dayMap = { "Mon": { late: 0, early: 0 }, "Tue": { late: 0, early: 0 }, "Wed": { late: 0, early: 0 }, "Thu": { late: 0, early: 0 }, "Fri": { late: 0, early: 0 }, "Sat": { late: 0, early: 0 }, "Sun": { late: 0, early: 0 } };

        attendances.forEach(a => {
            const dayStr = moment(a.date).tz("Asia/Kolkata").format("ddd");
            if (dayMap[dayStr]) {
                const isLate = (a.finalRemark && a.finalRemark.toLowerCase().includes('late')) ||
                               (a.sessions && a.sessions.some(s => s.clockInRemark && s.clockInRemark.toLowerCase().includes('late')));
                const isEarly = (a.finalRemark && (a.finalRemark.toLowerCase().includes('early') || a.finalRemark.toLowerCase().includes('left early'))) ||
                                (a.sessions && a.sessions.some(s => s.clockOutRemark && s.clockOutRemark.toLowerCase().includes('early')));
                if (isLate) dayMap[dayStr].late += 1;
                if (isEarly) dayMap[dayStr].early += 1;
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

const formatHoursToHHMM = (decimalHours) => {
    if (!decimalHours || decimalHours <= 0) return '00:00';
    const absHours = Math.abs(decimalHours);
    const hours = Math.floor(absHours);
    const minutes = Math.round((absHours - hours) * 60);
    let adjustedHours = hours;
    let adjustedMinutes = minutes;
    if (adjustedMinutes === 60) {
        adjustedHours += 1;
        adjustedMinutes = 0;
    }
    const formattedHours = adjustedHours < 10 ? `0${adjustedHours}` : adjustedHours;
    const formattedMins = adjustedMinutes < 10 ? `0${adjustedMinutes}` : adjustedMinutes;
    return `${formattedHours}:${formattedMins}`;
};

// 6. Export Attendance
router.get("/export-attendance", async (req, res) => {
    try {
        const { startDate, endDate, format } = req.query;
        const targetOrgIds = await getTargetOrgs(req);

        const start = startDate
            ? moment(startDate).tz("Asia/Kolkata").startOf("day")
            : moment().tz("Asia/Kolkata").startOf("month");
        const end = endDate
            ? moment(endDate).tz("Asia/Kolkata").endOf("day")
            : moment().tz("Asia/Kolkata").endOf("month");
        const today = moment().tz("Asia/Kolkata").endOf("day");
        const actualEnd = end.isAfter(today) ? today : end;

        const [employees, attendances, approvedLeaves, orgs, holidays] = await Promise.all([
            prisma.employee.findMany({
                where: {
                    organizationId: { in: targetOrgIds }
                },
                include: {
                    shift: true,
                    organization: { select: { id: true, organizationName: true, inTime: true, outTime: true } },
                    department: { select: { name: true } }
                }
            }),
            prisma.attendance.findMany({
                where: {
                    employee: { organizationId: { in: targetOrgIds } },
                    date: { gte: start.toDate(), lte: actualEnd.toDate() }
                },
                include: {
                    sessions: { orderBy: { clockInTime: 'asc' } },
                    employee: {
                        select: {
                            employeeName: true,
                            employeeEmail: true,
                            organization: { select: { organizationName: true } },
                            department: { select: { name: true } }
                        }
                    }
                },
                orderBy: { date: 'asc' }
            }),
            prisma.leave.findMany({
                where: {
                    employee: { organizationId: { in: targetOrgIds } },
                    status: 'Approved',
                    startDate: { lte: actualEnd.toDate() },
                    endDate: { gte: start.toDate() }
                }
            }),
            prisma.organization.findMany({
                where: { id: { in: targetOrgIds } },
                select: { id: true, organizationName: true, inTime: true, outTime: true }
            }),
            prisma.holiday.findMany({
                where: {
                    organizationId: { in: targetOrgIds },
                    startDate: { lte: actualEnd.toDate() },
                    endDate: { gte: start.toDate() }
                }
            })
        ]);

        const orgMap = {};
        orgs.forEach(o => { orgMap[o.id] = o; });

        const exportData = [];
        const employeeSummary = {};

        for (let m = start.clone(); m.isSameOrBefore(actualEnd); m.add(1, 'days')) {
            const currentDayName = m.format('dddd');
            const currentDateStr = m.format('YYYY-MM-DD');

            employees.forEach(emp => {
                const email = emp.employeeEmail || 'unknown';
                const orgInfo = orgMap[emp.organizationId] || emp.organization || {};
                const orgInTimeStr = orgInfo.inTime || '09:00';
                const orgOutTimeStr = orgInfo.outTime || '18:00';

                if (!employeeSummary[email]) {
                    employeeSummary[email] = {
                        EmployeeName: emp.employeeName,
                        Email: email,
                        Organization: orgInfo.organizationName || 'N/A',
                        Department: emp.department?.name || 'Unassigned',
                        ExpectedWorkingDays: 0,
                        PresentDays: 0,
                        AbsentDays: 0,
                        LeaveDays: 0,
                        WeekoffTaken: 0,
                        HolidayDays: 0,
                        LateLogins: 0,
                        EarlyLogouts: 0,
                        TotalDays: 0,
                        TotalDecimalHours: 0,
                        TotalExtraDecimalHours: 0
                    };
                }

                const attendance = attendances.find(a => 
                    a.employeeId === emp.id && 
                    moment(a.date).tz("Asia/Kolkata").format('YYYY-MM-DD') === currentDateStr
                );
                const isOnLeave = approvedLeaves.some(l => 
                    l.employeeId === emp.id && 
                    moment(l.startDate).tz("Asia/Kolkata").startOf('day').isSameOrBefore(m) && 
                    moment(l.endDate).tz("Asia/Kolkata").endOf('day').isSameOrAfter(m)
                );
                const isHoliday = holidays.some(h => 
                    h.organizationId === emp.organizationId &&
                    moment(h.startDate).tz("Asia/Kolkata").startOf('day').isSameOrBefore(m) && 
                    moment(h.endDate).tz("Asia/Kolkata").endOf('day').isSameOrAfter(m)
                );
                const isWeekOff = emp.shift?.weekOffs?.includes(currentDayName);

                let status = '';
                let loginTime = 'N/A';
                let logoutTime = 'N/A';
                let isLateLogin = 'No';
                let isEarlyLogout = 'No';
                let totalHours = 0;
                let extraHours = 0;

                employeeSummary[email].TotalDays += 1;

                if (attendance && attendance.sessions && attendance.sessions.length > 0) {
                    employeeSummary[email].PresentDays += 1;
                    const firstSession = attendance.sessions[0];
                    const lastSession = attendance.sessions[attendance.sessions.length - 1];

                    loginTime = firstSession.clockInTime 
                        ? moment(firstSession.clockInTime).tz('Asia/Kolkata').format('YYYY-MM-DD hh:mm A') 
                        : 'N/A';
                    logoutTime = lastSession.clockOutTime 
                        ? moment(lastSession.clockOutTime).tz('Asia/Kolkata').format('YYYY-MM-DD hh:mm A') 
                        : 'N/A';

                    // Robust calculation of total working hours across all sessions
                    let calculatedSessionHours = 0;
                    attendance.sessions.forEach(sess => {
                        if (sess.duration && sess.duration > 0) {
                            calculatedSessionHours += sess.duration;
                        } else if (sess.clockInTime && sess.clockOutTime) {
                            const diffMs = new Date(sess.clockOutTime).getTime() - new Date(sess.clockInTime).getTime();
                            if (diffMs > 0) {
                                calculatedSessionHours += parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));
                            }
                        }
                    });

                    // Use attendance.totalHours if positive and matches session math, else calculatedSessionHours
                    if (attendance.totalHours && attendance.totalHours > 0 && Math.abs(attendance.totalHours - calculatedSessionHours) < 0.1) {
                        totalHours = attendance.totalHours;
                    } else {
                        totalHours = calculatedSessionHours;
                    }

                    // Ensure hours are never negative
                    totalHours = Math.max(0, totalHours);
                    // Helper to parse time strings in either "09:00", "9:00 AM", "09:00 PM", "21:00"
                    const parseTimeStringToMoment = (dateMom, timeStr, defaultH, defaultM) => {
                        if (!timeStr) return dateMom.clone().set({ hour: defaultH, minute: defaultM, second: 0 });
                        const trimmed = String(timeStr).trim();
                        if (trimmed.includes('AM') || trimmed.includes('PM')) {
                            return moment.tz(`${dateMom.format('YYYY-MM-DD')} ${trimmed}`, 'YYYY-MM-DD hh:mm A', 'Asia/Kolkata');
                        }
                        const parts = trimmed.split(':').map(Number);
                        return dateMom.clone().set({ hour: parts[0] || defaultH, minute: parts[1] || defaultM, second: 0 });
                    };

                    const expectedInTime = parseTimeStringToMoment(m, emp.shift?.startTime || orgInTimeStr, 9, 0);
                    let expectedOutTime = parseTimeStringToMoment(m, emp.shift?.endTime || orgOutTimeStr, 18, 0);
                    if (expectedOutTime.isBefore(expectedInTime)) {
                        expectedOutTime.add(1, 'day');
                    }

                    const expectedShiftHours = Math.max(0, expectedOutTime.diff(expectedInTime, 'hours', true));

                    // Extra hours calculation: ONLY overtime beyond the scheduled shift working hours
                    // Example: 9 AM to 9 PM shift (12 hrs expected) -> 10 AM to 10 PM worked (12 hrs total) -> extraHours = 0
                    if (expectedShiftHours > 0 && totalHours > expectedShiftHours) {
                        extraHours = parseFloat((totalHours - expectedShiftHours).toFixed(2));
                    } else {
                        extraHours = 0;
                    }

                    extraHours = Math.max(0, Math.min(totalHours, extraHours));

                    employeeSummary[email].TotalDecimalHours += totalHours;
                    employeeSummary[email].TotalExtraDecimalHours += extraHours;

                    const isLate = firstSession.clockInTime && moment(firstSession.clockInTime).tz('Asia/Kolkata').isAfter(expectedInTime);
                    const isEarlyLeave = lastSession.clockOutTime && moment(lastSession.clockOutTime).tz('Asia/Kolkata').isBefore(expectedOutTime);

                    if (isLate) {
                        isLateLogin = 'Yes';
                        employeeSummary[email].LateLogins += 1;
                    }
                    if (isEarlyLeave) {
                        isEarlyLogout = 'Yes';
                        employeeSummary[email].EarlyLogouts += 1;
                    }

                    if (attendance.finalRemark && ['Half Day', 'Regularized'].includes(attendance.finalRemark)) {
                        status = attendance.finalRemark;
                    } else if (isLate && isEarlyLeave) {
                        status = 'Late Login & Early Leave';
                    } else if (isLate) {
                        status = 'Late Login';
                    } else if (isEarlyLeave) {
                        status = 'Early Leave';
                    } else {
                        status = 'On Time';
                    }
                } else if (attendance) {
                    employeeSummary[email].PresentDays += 1;
                    status = attendance.finalRemark || 'Present';
                    totalHours = Math.max(0, attendance.totalHours || 0);
                    extraHours = Math.max(0, Math.min(totalHours, attendance.extraHours || 0));
                    employeeSummary[email].TotalDecimalHours += totalHours;
                    employeeSummary[email].TotalExtraDecimalHours += extraHours;
                } else {
                    if (isOnLeave) {
                        status = 'On Leave';
                        employeeSummary[email].LeaveDays += 1;
                    } else if (isHoliday) {
                        status = 'Holiday';
                        employeeSummary[email].HolidayDays += 1;
                    } else if (isWeekOff) {
                        status = 'Week Off';
                        employeeSummary[email].WeekoffTaken += 1;
                    } else {
                        status = 'Absent';
                        employeeSummary[email].AbsentDays += 1;
                    }
                }

                if (!isWeekOff && !isHoliday) {
                    employeeSummary[email].ExpectedWorkingDays += 1;
                }

                exportData.push({
                    EmployeeName: emp.employeeName,
                    Email: email,
                    Organization: orgInfo.organizationName || 'N/A',
                    Department: emp.department?.name || 'Unassigned',
                    Date: currentDateStr,
                    'Login Date & Time': loginTime,
                    'Logout Date & Time': logoutTime,
                    LateLogin: isLateLogin,
                    EarlyLogout: isEarlyLogout,
                    TotalHours: formatHoursToHHMM(totalHours),
                    ExtraHours: formatHoursToHHMM(extraHours),
                    Status: status
                });
            });
        }

        exportData.sort((a, b) => new Date(b.Date) - new Date(a.Date));

        const summaryData = Object.values(employeeSummary).map(emp => ({
            'Employee Name': emp.EmployeeName,
            'Expected Working Days': emp.ExpectedWorkingDays,
            'Absentee / Leaves': emp.AbsentDays + emp.LeaveDays,
            'Late Login': emp.LateLogins,
            'Early Logout': emp.EarlyLogouts,
            'Extra Working Hours': formatHoursToHHMM(emp.TotalExtraDecimalHours),
            'Week Off': emp.WeekoffTaken,
            'Holiday': emp.HolidayDays,
            'Present Days': emp.PresentDays,
            'Total Days': emp.TotalDays
        }));

        if (format === 'csv') {
            const headers = ['Employee Name', 'Email', 'Organization', 'Department', 'Date', 'Clock In', 'Clock Out', 'Late Login', 'Early Logout', 'Total Hours', 'Extra Hours', 'Status'];
            const rows = exportData.map(d => [
                `"${d.EmployeeName}"`,
                `"${d.Email}"`,
                `"${d.Organization}"`,
                `"${d.Department}"`,
                `"${d.Date}"`,
                `"${d.LoginTime}"`,
                `"${d.LogoutTime}"`,
                `"${d.LateLogin}"`,
                `"${d.EarlyLogout}"`,
                `"${d.TotalHours}"`,
                `"${d.ExtraHours}"`,
                `"${d.Status}"`
            ].join(','));
            const csv = [headers.join(','), ...rows].join('\n');
            const fromStr = start.format("DDMMYYYY");
            const toStr = actualEnd.format("DDMMYYYY");
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="attendance_${fromStr}_${toStr}.csv"`);
            return res.status(200).send(csv);
        }

        res.status(200).json({ exportData, summaryData });
    } catch (error) {
        console.error('Error in /reports/export-attendance:', error);
        res.status(500).send({ message: "Internal Server Error", error: error.message });
    }
});

module.exports = router;
