const prisma = require('../prisma/client');
const moment = require('moment-timezone');

const PALETTE = ['#3B82F6', '#10B981', '#8B5CF6', '#38BDF8', '#F59E0B', '#EC4899', '#06B6D4', '#6366F1'];

exports.getCompanyComparison = async (req, res) => {
  try {
    const adminId = req.adminId;
    let orgIds = req.groupOrgIds || [];

    // If orgIds not attached by middleware, look them up for this admin
    if (orgIds.length === 0 && adminId) {
      const superRoles = await prisma.adminRole.findMany({
        where: { adminId: adminId, role: 'SUPER_ADMIN' }
      });

      if (superRoles && superRoles.length > 0) {
        const collectedIds = [];
        for (const role of superRoles) {
          if (role.organizationId) {
            collectedIds.push(role.organizationId);
            const children = await prisma.organization.findMany({
              where: { parentId: role.organizationId },
              select: { id: true }
            });
            children.forEach(c => collectedIds.push(c.id));
          } else {
            const allOrgs = await prisma.organization.findMany({ select: { id: true } });
            orgIds = allOrgs.map(o => o.id);
            break;
          }
        }
        if (orgIds.length === 0) {
          orgIds = [...new Set(collectedIds)];
        }
      }
    }

    if (orgIds.length === 0) {
      return res.status(200).json({
        period: req.query.period || req.query.month || moment().format('MMM YYYY'),
        summary: {
          totalEmployees: 0,
          avgAttendance: 0,
          totalSalary: '₹0L',
          totalSalaryNum: 0,
          totalRevenue: '₹0L',
          totalRevenueNum: 0
        },
        companies: []
      });
    }

    // Determine target date range
    const now = moment().tz('Asia/Kolkata');
    let startPeriod = now.clone().startOf('month').toDate();
    let endPeriod = now.clone().endOf('month').toDate();

    if (req.query.startDate && req.query.endDate) {
      startPeriod = moment.tz(req.query.startDate, 'Asia/Kolkata').startOf('day').toDate();
      endPeriod = moment.tz(req.query.endDate, 'Asia/Kolkata').endOf('day').toDate();
    } else if (req.query.period || req.query.month) {
      const p = (req.query.period || req.query.month).trim();
      if (moment(p, 'MMM YYYY', true).isValid()) {
        const m = moment.tz(p, 'MMM YYYY', 'Asia/Kolkata');
        startPeriod = m.clone().startOf('month').toDate();
        endPeriod = m.clone().endOf('month').toDate();
      } else if (moment(p, 'MMMM YYYY', true).isValid()) {
        const m = moment.tz(p, 'MMMM YYYY', 'Asia/Kolkata');
        startPeriod = m.clone().startOf('month').toDate();
        endPeriod = m.clone().endOf('month').toDate();
      } else if (p.startsWith('Q1')) {
        const year = p.split(' ')[1] || now.format('YYYY');
        startPeriod = moment.tz(`${year}-04-01`, 'Asia/Kolkata').startOf('day').toDate();
        endPeriod = moment.tz(`${year}-06-30`, 'Asia/Kolkata').endOf('day').toDate();
      } else if (p.startsWith('Q2')) {
        const year = p.split(' ')[1] || now.format('YYYY');
        startPeriod = moment.tz(`${year}-07-01`, 'Asia/Kolkata').startOf('day').toDate();
        endPeriod = moment.tz(`${year}-09-30`, 'Asia/Kolkata').endOf('day').toDate();
      } else if (p.startsWith('FY')) {
        const parts = p.replace('FY', '').trim().split('-');
        const startYear = parts[0] || now.format('YYYY');
        const endYearSuffix = parts[1] || String(Number(startYear) + 1).slice(-2);
        startPeriod = moment.tz(`${startYear}-04-01`, 'Asia/Kolkata').startOf('day').toDate();
        endPeriod = moment.tz(`20${endYearSuffix}-03-31`, 'Asia/Kolkata').endOf('day').toDate();
      }
    }

    // Fetch organizations
    const orgs = await prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: {
        id: true,
        organizationName: true,
        organizationCode: true,
        organizationProfilePic: true,
        employeeCount: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const companies = [];

    for (let i = 0; i < orgs.length; i++) {
      const org = orgs[i];

      // 1. Employee Count
      const activeEmployees = await prisma.employee.count({
        where: { organizationId: org.id, status: 'active' }
      });
      const employees = activeEmployees > 0 ? activeEmployees : (org.employeeCount || 0);

      // 2. Attendance Benchmark
      const totalAttendance = await prisma.attendance.count({
        where: {
          employee: { organizationId: org.id },
          date: { gte: startPeriod, lte: endPeriod }
        }
      });
      const presentAttendance = await prisma.attendance.count({
        where: {
          employee: { organizationId: org.id },
          date: { gte: startPeriod, lte: endPeriod },
          finalRemark: { in: ['Present', 'Half Day', 'Clocked In', 'Regularized', 'Left Early'] }
        }
      });

      const attendanceRate = totalAttendance > 0 
        ? Math.min(100, Math.round((presentAttendance / totalAttendance) * 100)) 
        : 0;

      // 3. Salary Cost
      const salaryAgg = await prisma.employee.aggregate({
        where: { organizationId: org.id, status: 'active' },
        _sum: { salary: true }
      });
      const rawSalary = salaryAgg._sum.salary || 0;
      const salaryNum = rawSalary > 0 ? parseFloat((rawSalary / 100000).toFixed(1)) : 0;
      const salaryCost = `₹${salaryNum}L`;

      // 4. Expenses
      const expenseAgg = await prisma.expense.aggregate({
        where: {
          organizationId: org.id,
          status: { in: ['APPROVED', 'PAID'] },
          createdAt: { gte: startPeriod, lte: endPeriod }
        },
        _sum: { amount: true }
      });
      const rawExpense = expenseAgg._sum.amount || 0;
      const expenseNum = rawExpense > 0 ? parseFloat((rawExpense / 100000).toFixed(1)) : 0;
      const expenses = `₹${expenseNum}L`;

      // 5. Growth & Palette Color
      const growth = 0;
      const color = PALETTE[i % PALETTE.length];

      companies.push({
        id: org.id,
        name: org.organizationName,
        organizationCode: org.organizationCode,
        profilePic: org.organizationProfilePic || null,
        employees,
        attendance: attendanceRate,
        salaryCost,
        salaryNum,
        revenue: '₹0L',
        revenueNum: 0,
        expenses,
        growth,
        color
      });
    }

    const totalEmployees = companies.reduce((acc, c) => acc + c.employees, 0);
    const avgAttendance = companies.length > 0 
      ? Math.round(companies.reduce((acc, c) => acc + c.attendance, 0) / companies.length) 
      : 0;
    const totalSalaryNum = parseFloat(companies.reduce((acc, c) => acc + c.salaryNum, 0).toFixed(1));
    const totalRevenueNum = parseFloat(companies.reduce((acc, c) => acc + c.revenueNum, 0).toFixed(1));

    return res.status(200).json({
      period: req.query.period || req.query.month || moment(startPeriod).format('MMM YYYY'),
      startDate: startPeriod,
      endDate: endPeriod,
      summary: {
        totalEmployees,
        avgAttendance,
        totalSalary: `₹${totalSalaryNum}L`,
        totalSalaryNum,
        totalRevenue: `₹${totalRevenueNum}L`,
        totalRevenueNum
      },
      companies
    });

  } catch (error) {
    console.error('Error in getCompanyComparison:', error);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
