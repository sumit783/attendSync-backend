const express = require('express');
const router = express.Router();
const prisma = require('../prisma/client');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const moment = require('moment-timezone');
const cache = require('../utils/cache');

// Helper to determine orgs to query
const getOrgIdsToQuery = async (adminId, requestedCompanyId) => {
    // Cache org hierarchy per admin for 5 minutes
    const cacheKey = `orgIds:${adminId}:${requestedCompanyId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    if (requestedCompanyId && requestedCompanyId !== 'all') {
        cache.set(cacheKey, [requestedCompanyId], 300);
        return [requestedCompanyId];
    }

    // If 'all', find all orgs accessible to this admin
    const roles = await prisma.adminRole.findMany({
        where: { adminId },
        select: { organizationId: true }
    });

    // Check for global admin (role with no organizationId)
    const isGlobalAdmin = roles.some(r => !r.organizationId);
    if (isGlobalAdmin) {
        const allOrgs = await prisma.organization.findMany({ select: { id: true } });
        const ids = allOrgs.map(o => o.id);
        cache.set(cacheKey, ids, 300);
        return ids;
    }

    const parentOrgIds = roles.map(r => r.organizationId).filter(Boolean);

    // Single bulk query for all children — eliminates N+1 loop
    const children = await prisma.organization.findMany({
        where: { parentId: { in: parentOrgIds } },
        select: { id: true }
    });

    const orgIds = [...new Set([...parentOrgIds, ...children.map(c => c.id)])];
    cache.set(cacheKey, orgIds, 300);
    return orgIds;
};

// GET /api/organization/analytics/companies
router.get('/companies', authenticateAdmin, async (req, res) => {
    try {
        const orgIds = await getOrgIdsToQuery(req.adminId, 'all');
        const orgs = await prisma.organization.findMany({
            where: { id: { in: orgIds } },
            include: { 
                employees: { where: { status: 'active' } },
                departments: {
                    include: { employees: { where: { status: 'active' } } }
                }
            }
        });

        const startOfMonth = moment().tz('Asia/Kolkata').startOf('month').toDate();
        const endOfMonth = moment().tz('Asia/Kolkata').endOf('month').toDate();
        
        const attendances = await prisma.attendance.findMany({
            where: {
                employee: { organizationId: { in: orgIds } },
                date: { gte: startOfMonth, lte: endOfMonth }
            },
            select: { employeeId: true, finalRemark: true }
        });

        const attByEmp = {};
        for (const a of attendances) {
            if (!attByEmp[a.employeeId]) attByEmp[a.employeeId] = { total: 0, present: 0 };
            attByEmp[a.employeeId].total += 1;
            if (['Present', 'Half Day', 'Left Early', 'Clocked In', 'Regularized', 'On Time', 'Late', 'Early Login', 'Late & Left Early'].includes(a.finalRemark)) {
                attByEmp[a.employeeId].present += 1;
            }
        }

        const colors = ['#38bdf8', '#10b981', '#a855f7', '#f59e0b', '#0ea5e9'];
        
        const companies = orgs.map((org, index) => {
            const orgPayroll = org.employees.reduce((sum, emp) => sum + (emp.salary || 0), 0);
            const avgSalary = org.employees.length > 0 ? Math.round(orgPayroll / org.employees.length) : 0;
            
            let orgTotalAtt = 0;
            let orgPresentAtt = 0;

            const departments = org.departments.map(d => {
                const depPayroll = d.employees.reduce((sum, emp) => sum + (emp.salary || 0), 0);
                let depTotalAtt = 0;
                let depPresentAtt = 0;
                
                for (const emp of d.employees) {
                    if (attByEmp[emp.id]) {
                        depTotalAtt += attByEmp[emp.id].total;
                        depPresentAtt += attByEmp[emp.id].present;
                    }
                }
                
                orgTotalAtt += depTotalAtt;
                orgPresentAtt += depPresentAtt;

                const depAttendance = depTotalAtt > 0 ? Math.round((depPresentAtt / depTotalAtt) * 100) : 0;
                
                let depStatus = 'At Risk';
                if (depAttendance >= 85) depStatus = 'Healthy';
                else if (depAttendance >= 70) depStatus = 'Stable';

                return {
                    name: d.name,
                    employees: d.employees.length,
                    attendance: depAttendance,
                    payroll: parseFloat((depPayroll / 100000).toFixed(2)),
                    payrollShare: orgPayroll > 0 ? Math.round((depPayroll / orgPayroll) * 100) : 0,
                    status: depStatus,
                    color: colors[0]
                };
            });

            // Handle employees without department
            const unassignedEmps = org.employees.filter(emp => !emp.departmentId);
            if (unassignedEmps.length > 0) {
                const depPayroll = unassignedEmps.reduce((sum, emp) => sum + (emp.salary || 0), 0);
                let depTotalAtt = 0;
                let depPresentAtt = 0;
                
                for (const emp of unassignedEmps) {
                    if (attByEmp[emp.id]) {
                        depTotalAtt += attByEmp[emp.id].total;
                        depPresentAtt += attByEmp[emp.id].present;
                    }
                }
                
                orgTotalAtt += depTotalAtt;
                orgPresentAtt += depPresentAtt;

                const depAttendance = depTotalAtt > 0 ? Math.round((depPresentAtt / depTotalAtt) * 100) : 0;
                
                let depStatus = 'At Risk';
                if (depAttendance >= 85) depStatus = 'Healthy';
                else if (depAttendance >= 70) depStatus = 'Stable';

                departments.push({
                    name: 'Main Unit',
                    employees: unassignedEmps.length,
                    attendance: depAttendance,
                    payroll: parseFloat((depPayroll / 100000).toFixed(2)),
                    payrollShare: orgPayroll > 0 ? Math.round((depPayroll / orgPayroll) * 100) : 0,
                    status: depStatus,
                    color: colors[0]
                });
            }

            const orgAttendance = orgTotalAtt > 0 ? Math.round((orgPresentAtt / orgTotalAtt) * 100) : 0;

            return {
                id: org.id,
                name: org.organizationName,
                avatarLetter: org.organizationName.charAt(0).toUpperCase(),
                avatarColor: colors[index % colors.length],
                industry: 'Organization',
                employees: org.employees.length,
                attendance: orgAttendance,
                avgSalary: avgSalary,
                monthlyPayroll: parseFloat((orgPayroll / 100000).toFixed(2)),
                payrollShare: 0, 
                status: orgAttendance >= 85 ? 'Healthy' : (orgAttendance >= 70 ? 'Stable' : 'At Risk'),
                empTrend: '+5%',
                attTrend: '+2%',
                payrollTrend: '+4%',
                salaryTrend: '+3%',
                departments: departments
            };
        });

        res.json(companies);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// GET /api/organization/analytics/performance-trend
router.get('/performance-trend', authenticateAdmin, async (req, res) => {
    try {
        const { companyId } = req.query;
        const orgIds = await getOrgIdsToQuery(req.adminId, companyId);
        
        if (orgIds.length === 0) return res.json([]);

        const monthsData = [];
        for (let i = 5; i >= 0; i--) {
            const m = moment().tz('Asia/Kolkata').subtract(i, 'months');
            const start = m.clone().startOf('month').toDate();
            const end = m.clone().endOf('month').toDate();
            
            // 1. Task Score (Max 30)
            const tasksThisMonth = await prisma.task.findMany({
                where: { 
                    organizationId: { in: orgIds }, 
                    createdAt: { gte: start, lte: end } 
                },
                select: { status: true }
            });
            const totalTasks = tasksThisMonth.length;
            const completedTasks = tasksThisMonth.filter(t => t.status === 'COMPLETED').length;
            const taskScore = totalTasks > 0 ? (completedTasks / totalTasks) * 30 : 25; // default 25 if no tasks
            
            // 2. Attendance & Punctuality Scores (Max 40 + Max 30)
            const attendances = await prisma.attendance.findMany({
                where: {
                    employee: { organizationId: { in: orgIds } },
                    date: { gte: start, lte: end }
                },
                select: { finalRemark: true }
            });
            
            const totalAttendances = attendances.length;
            const PRESENT_REMARKS = ['Present', 'Half Day', 'Left Early', 'Clocked In', 'Regularized'];
            const presentCount = attendances.filter(a => PRESENT_REMARKS.includes(a.finalRemark)).length;
            
            const attendanceScore = totalAttendances > 0 ? (presentCount / totalAttendances) * 40 : 35; 
            
            // For punctuality, we simplify by assuming 90% of present days are on time if data is absent
            const punctualityScore = totalAttendances > 0 ? (presentCount / totalAttendances) * 0.9 * 30 : 28; 
            
            // Determine total score
            let totalScore = Math.round(attendanceScore + punctualityScore + taskScore);
            
            // Bound between 0 and 100
            totalScore = Math.max(0, Math.min(100, totalScore));

            monthsData.push({
                month: m.format('MMM'),
                avgScore: totalScore
            });
        }

        res.json(monthsData);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// GET /api/organization/analytics/stats
router.get('/stats', authenticateAdmin, async (req, res) => {
    try {
        const { companyId, month } = req.query; // month e.g., 'Sep 2025' or ISO date
        const orgIds = await getOrgIdsToQuery(req.adminId, companyId);
        
        if (orgIds.length === 0) return res.json({ employees: 0, attendance: 0, payroll: 0, avgSalary: 0 });

        const employees = await prisma.employee.findMany({
            where: { organizationId: { in: orgIds }, status: 'active' },
            select: { salary: true }
        });

        const totalEmployees = employees.length;
        const totalPayroll = employees.reduce((sum, emp) => sum + (emp.salary || 0), 0);
        const avgSalary = totalEmployees > 0 ? Math.round(totalPayroll / totalEmployees) : 0;
        
        // Mock attendance for now, or calculate based on Attendance table
        const attendance = 90; // Default

        res.json({
            employees: totalEmployees,
            attendance: attendance,
            payroll: totalPayroll,
            avgSalary: avgSalary,
            empTrend: '+0%',
            attTrend: '+0%',
            payrollTrend: '+0%',
            salaryTrend: '+0%'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// GET /api/organization/analytics/comparison
router.get('/comparison', authenticateAdmin, async (req, res) => {
    try {
        const { companyId } = req.query;
        const orgIds = await getOrgIdsToQuery(req.adminId, companyId);
        
        const startOfMonth = moment().tz('Asia/Kolkata').startOf('month').toDate();
        const endOfMonth = moment().tz('Asia/Kolkata').endOf('month').toDate();
        
        const attendances = await prisma.attendance.findMany({
            where: {
                employee: { organizationId: { in: orgIds } },
                date: { gte: startOfMonth, lte: endOfMonth }
            },
            select: { employeeId: true, finalRemark: true }
        });

        const attByEmp = {};
        for (const a of attendances) {
            if (!attByEmp[a.employeeId]) attByEmp[a.employeeId] = { total: 0, present: 0 };
            attByEmp[a.employeeId].total += 1;
            if (['Present', 'Half Day', 'Left Early', 'Clocked In', 'Regularized', 'On Time', 'Late', 'Early Login', 'Late & Left Early'].includes(a.finalRemark)) {
                attByEmp[a.employeeId].present += 1;
            }
        }

        if (companyId === 'all') {
            // Group by Sub-Companies
            const orgs = await prisma.organization.findMany({
                where: { id: { in: orgIds } },
                include: { employees: { where: { status: 'active' } } }
            });
            
            const data = orgs.map(org => {
                const payroll = org.employees.reduce((sum, emp) => sum + (emp.salary || 0), 0);
                
                let orgTotalAtt = 0;
                let orgPresentAtt = 0;
                for (const emp of org.employees) {
                    if (attByEmp[emp.id]) {
                        orgTotalAtt += attByEmp[emp.id].total;
                        orgPresentAtt += attByEmp[emp.id].present;
                    }
                }
                const orgAttendance = orgTotalAtt > 0 ? Math.round((orgPresentAtt / orgTotalAtt) * 100) : 0;

                return {
                    name: org.organizationName,
                    Employees: org.employees.length,
                    'Attendance %': orgAttendance,
                    'Monthly Payroll (L)': parseFloat((payroll / 100000).toFixed(2))
                };
            });
            return res.json(data);
        } else {
            // Group by Departments for a single company
            const departments = await prisma.department.findMany({
                where: { organizationId: { in: orgIds } },
                include: { employees: { where: { status: 'active' } } }
            });

            const data = departments.map(dep => {
                const payroll = dep.employees.reduce((sum, emp) => sum + (emp.salary || 0), 0);
                
                let depTotalAtt = 0;
                let depPresentAtt = 0;
                for (const emp of dep.employees) {
                    if (attByEmp[emp.id]) {
                        depTotalAtt += attByEmp[emp.id].total;
                        depPresentAtt += attByEmp[emp.id].present;
                    }
                }
                const depAttendance = depTotalAtt > 0 ? Math.round((depPresentAtt / depTotalAtt) * 100) : 0;

                return {
                    name: dep.name,
                    Employees: dep.employees.length,
                    'Attendance %': depAttendance,
                    'Monthly Payroll (L)': parseFloat((payroll / 100000).toFixed(2))
                };
            });

            // Handle employees without department
            const unassignedEmps = await prisma.employee.findMany({
                where: {
                    organizationId: { in: orgIds },
                    departmentId: null,
                    status: 'active'
                }
            });

            if (unassignedEmps.length > 0) {
                const payroll = unassignedEmps.reduce((sum, emp) => sum + (emp.salary || 0), 0);
                let unTotalAtt = 0;
                let unPresentAtt = 0;
                for (const emp of unassignedEmps) {
                    if (attByEmp[emp.id]) {
                        unTotalAtt += attByEmp[emp.id].total;
                        unPresentAtt += attByEmp[emp.id].present;
                    }
                }
                const unAttendance = unTotalAtt > 0 ? Math.round((unPresentAtt / unTotalAtt) * 100) : 0;
                data.push({
                    name: 'Main Unit',
                    Employees: unassignedEmps.length,
                    'Attendance %': unAttendance,
                    'Monthly Payroll (L)': parseFloat((payroll / 100000).toFixed(2))
                });
            }

            return res.json(data);
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// GET /api/organization/analytics/attendance-pie
router.get('/attendance-pie', authenticateAdmin, async (req, res) => {
    try {
        const { companyId } = req.query;
        const orgIds = await getOrgIdsToQuery(req.adminId, companyId);
        const colors = ['#38bdf8', '#10b981', '#a855f7', '#f59e0b', '#0ea5e9'];
        
        if (companyId === 'all') {
            const orgs = await prisma.organization.findMany({ where: { id: { in: orgIds } } });
            const data = orgs.map((org, i) => ({
                name: org.organizationName,
                value: 90 + (i % 5), // Mock variance
                color: colors[i % colors.length]
            }));
            return res.json(data);
        } else {
            const departments = await prisma.department.findMany({ where: { organizationId: { in: orgIds } } });
            const data = departments.map((dep, i) => ({
                name: dep.name,
                value: 90 + (i % 5),
                color: colors[i % colors.length]
            }));
            return res.json(data);
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// GET /api/organization/analytics/payroll-pie
router.get('/payroll-pie', authenticateAdmin, async (req, res) => {
    try {
        const { companyId } = req.query;
        const orgIds = await getOrgIdsToQuery(req.adminId, companyId);
        const colors = ['#38bdf8', '#10b981', '#a855f7', '#f59e0b', '#0ea5e9'];
        
        if (companyId === 'all') {
            const orgs = await prisma.organization.findMany({
                where: { id: { in: orgIds } },
                include: { employees: { where: { status: 'active' } } }
            });
            
            let totalPayroll = 0;
            orgs.forEach(o => o.employees.forEach(e => totalPayroll += (e.salary || 0)));

            const data = orgs.map((org, i) => {
                const payroll = org.employees.reduce((sum, emp) => sum + (emp.salary || 0), 0);
                const payrollLakhs = parseFloat((payroll / 100000).toFixed(2));
                const value = totalPayroll > 0 ? Math.round((payroll / totalPayroll) * 100) : 0;
                return { name: org.organizationName, value, payrollLakhs, color: colors[i % colors.length] };
            });
            return res.json(data);
        } else {
            const departments = await prisma.department.findMany({
                where: { organizationId: { in: orgIds } },
                include: { employees: { where: { status: 'active' } } }
            });

            let totalPayroll = 0;
            departments.forEach(d => d.employees.forEach(e => totalPayroll += (e.salary || 0)));

            const data = departments.map((dep, i) => {
                const payroll = dep.employees.reduce((sum, emp) => sum + (emp.salary || 0), 0);
                const payrollLakhs = parseFloat((payroll / 100000).toFixed(2));
                const value = totalPayroll > 0 ? Math.round((payroll / totalPayroll) * 100) : 0;
                return { name: dep.name, value, payrollLakhs, color: colors[i % colors.length] };
            });
            return res.json(data);
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// GET /api/organization/analytics/monthly-history
router.get('/monthly-history', authenticateAdmin, async (req, res) => {
    try {
        const { companyId } = req.query;
        
        // Mock data for monthly history to keep it simple, since calculating historical trends 
        // accurately requires timeseries logs which aren't fully defined in schema without extensive queries.
        if (companyId === 'all') {
            const data = [
                { month: 'Apr', 'Company 1': 32, 'Company 2': 46, 'Company 3': 38 },
                { month: 'May', 'Company 1': 36, 'Company 2': 49, 'Company 3': 41 },
                { month: 'Jun', 'Company 1': 39, 'Company 2': 54, 'Company 3': 44 },
                { month: 'Jul', 'Company 1': 40, 'Company 2': 60, 'Company 3': 49 },
                { month: 'Aug', 'Company 1': 41, 'Company 2': 64, 'Company 3': 52 },
                { month: 'Sep', 'Company 1': 42, 'Company 2': 68, 'Company 3': 55 }
            ];
            return res.json(data);
        } else {
            const data = [
                { month: 'Apr', employees: 32, attendance: 90, payroll: 12.3 },
                { month: 'May', employees: 36, attendance: 92, payroll: 13.8 },
                { month: 'Jun', employees: 39, attendance: 93, payroll: 14.9 },
                { month: 'Jul', employees: 40, attendance: 91, payroll: 15.3 },
                { month: 'Aug', employees: 41, attendance: 93, payroll: 15.8 },
                { month: 'Sep', employees: 42, attendance: 94, payroll: 16.2 }
            ];
            return res.json(data);
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// GET /api/organization/analytics/waterfall
router.get('/waterfall', authenticateAdmin, async (req, res) => {
    try {
        const { companyId } = req.query;
        // Providing mocked waterfall data to avoid complex historical HR logs which don't exist
        if (companyId === 'all') {
            const data = [
                { name: 'Q2 Base', base: 0, change: 116, total: 116, type: 'start', fill: '#0ea5e9' },
                { name: 'Growth', base: 116, change: 49, total: 165, type: 'add', fill: '#10b981' },
                { name: 'Current Total', base: 0, change: 165, total: 165, type: 'end', fill: '#0284c7' }
            ];
            return res.json(data);
        } else {
            const data = [
                { name: 'Q2 Starting', base: 0, change: 32, total: 32, type: 'start', fill: '#0ea5e9' },
                { name: 'Hires (+12)', base: 32, change: 12, total: 44, type: 'add', fill: '#10b981' },
                { name: 'Exits (-2)', base: 42, change: 2, total: 42, type: 'sub', fill: '#ef4444' },
                { name: 'Ending Count', base: 0, change: 42, total: 42, type: 'end', fill: '#38bdf8' }
            ];
            return res.json(data);
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// GET /api/organization/analytics/export-analytics
// Returns per-company attendance, employee, and payroll data for Excel export
router.get('/export-analytics', authenticateAdmin, async (req, res) => {
    try {
        const { startDate, endDate, companyId } = req.query;
        const orgIds = await getOrgIdsToQuery(req.adminId, companyId || 'all');

        const start = startDate
            ? moment(startDate).tz('Asia/Kolkata').startOf('day').toDate()
            : moment().tz('Asia/Kolkata').startOf('month').toDate();
        const end = endDate
            ? moment(endDate).tz('Asia/Kolkata').endOf('day').toDate()
            : moment().tz('Asia/Kolkata').endOf('month').toDate();

        // Fetch all attendance records in range
        const attendances = await prisma.attendance.findMany({
            where: {
                employee: { organizationId: { in: orgIds } },
                date: { gte: start, lte: end }
            },
            include: {
                sessions: { orderBy: { clockInTime: 'asc' } },
                employee: {
                    select: {
                        id: true,
                        employeeName: true,
                        employeeEmail: true,
                        organizationId: true,
                        salary: true,
                        department: { select: { name: true } }
                    }
                }
            },
            orderBy: { date: 'asc' }
        });

        // Fetch orgs
        const orgs = await prisma.organization.findMany({
            where: { id: { in: orgIds } },
            select: { id: true, organizationName: true }
        });

        // Build per-org data
        const result = {};
        for (const org of orgs) {
            result[org.id] = {
                name: org.organizationName,
                rows: []
            };
        }

        for (const a of attendances) {
            const emp = a.employee;
            if (!emp || !result[emp.organizationId]) continue;

            let clockIn = '';
            let clockOut = '';
            if (a.sessions && a.sessions.length > 0) {
                const firstSession = a.sessions[0];
                const lastSession = a.sessions[a.sessions.length - 1];
                clockIn = firstSession.clockInTime
                    ? moment(firstSession.clockInTime).tz('Asia/Kolkata').format('hh:mm A')
                    : '';
                clockOut = lastSession.clockOutTime
                    ? moment(lastSession.clockOutTime).tz('Asia/Kolkata').format('hh:mm A')
                    : '';
            }

            const totalDecimalHours = a.totalHours || 0;
            const hours = Math.floor(totalDecimalHours);
            const mins = Math.round((totalDecimalHours - hours) * 60);
            const workHours = totalDecimalHours > 0 ? `${hours}h ${mins}m` : (clockIn ? 'In Progress' : '0h 0m');

            const isLate = (a.finalRemark && a.finalRemark.toLowerCase().includes('late')) ||
                           (a.sessions && a.sessions.some(s => s.clockInRemark && s.clockInRemark.toLowerCase().includes('late')));
            const isEarlyOut = (a.finalRemark && (a.finalRemark.toLowerCase().includes('early') || a.finalRemark.toLowerCase().includes('left early'))) ||
                               (a.sessions && a.sessions.some(s => s.clockOutRemark && s.clockOutRemark.toLowerCase().includes('early')));

            result[emp.organizationId].rows.push({
                'Employee Name': emp.employeeName || '',
                'Email': emp.employeeEmail || '',
                'Department': emp.department?.name || 'Unassigned',
                'Date': moment(a.date).tz('Asia/Kolkata').format('DD-MM-YYYY'),
                'Clock In': clockIn || 'N/A',
                'Clock Out': clockOut || 'N/A',
                'Clock In (Login)': clockIn || 'N/A',
                'Clock Out (Logout)': clockOut || 'N/A',
                'Status': a.finalRemark || 'Present',
                'Is Late': isLate ? 'Yes' : 'No',
                'Early Out': isEarlyOut ? 'Yes' : 'No',
                'Work Hours': workHours,
                'Total Working Hours': workHours,
                'Salary (₹)': emp.salary || 0
            });
        }

        // Convert to array of { name, rows }
        const sheets = Object.values(result).filter((s) => s.rows.length > 0);
        return res.json(sheets);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

module.exports = router;
