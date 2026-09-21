const prisma = require('../prisma/client');
const moment = require('moment-timezone');

const PALETTE = ['#3B82F6', '#10B981', '#8B5CF6', '#38BDF8', '#F59E0B', '#EC4899', '#06B6D4', '#6366F1'];

exports.getCompanyComparison = async (req, res) => {
  try {
    const adminId = req.adminId;
    let orgIds = req.groupOrgIds || [];

    // If orgIds not attached by middleware, look them up for this admin
    if (orgIds.length === 0 && adminId) {
      const superRoles = req.adminRoles
        ? req.adminRoles.filter(r => r.role === 'SUPER_ADMIN')
        : await prisma.adminRole.findMany({
            where: { adminId: adminId, role: 'SUPER_ADMIN' }
          });

      if (superRoles && superRoles.length > 0) {
        const parentIds = superRoles.map(r => r.organizationId).filter(Boolean);
        if (parentIds.length > 0) {
          const children = await prisma.organization.findMany({
            where: { parentId: { in: parentIds } },
            select: { id: true }
          });
          orgIds = [...new Set([...parentIds, ...children.map(c => c.id)])];
        } else if (superRoles.some(r => !r.organizationId)) {
          const allOrgs = await prisma.organization.findMany({ select: { id: true } });
          orgIds = allOrgs.map(o => o.id);
        }
      }

      // Fallback: If no super role, look up any organizations the admin belongs to
      if (orgIds.length === 0) {
        const adminRoles = req.adminRoles || await prisma.adminRole.findMany({
          where: { adminId: adminId }
        });
        if (adminRoles && adminRoles.length > 0) {
          orgIds = [...new Set(adminRoles.map(r => r.organizationId).filter(Boolean))];
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

    if (orgs.length === 0) {
      return res.status(200).json({
        period: req.query.period || req.query.month || moment(startPeriod).format('MMM YYYY'),
        startDate: startPeriod,
        endDate: endPeriod,
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

    const validOrgIds = orgs.map(o => o.id);
    const validOrgCodes = orgs.map(o => o.organizationCode).filter(Boolean);

    // Run batch aggregations in parallel via Promise.all (single roundtrip instead of N loops)
    const [employeeGroupStats, totalAttStats, presentAttStats, expenseGroupStats] = await Promise.all([
      // 1. Employee count & salary sum grouped by organizationId
      prisma.employee.groupBy({
        by: ['organizationId'],
        where: { organizationId: { in: validOrgIds }, status: 'active' },
        _count: { id: true },
        _sum: { salary: true }
      }),

      // 2. Total attendance grouped by organizationCode (using index [organizationCode, date])
      validOrgCodes.length > 0
        ? prisma.attendance.groupBy({
            by: ['organizationCode'],
            where: {
              organizationCode: { in: validOrgCodes },
              date: { gte: startPeriod, lte: endPeriod }
            },
            _count: { id: true }
          })
        : [],

      // 3. Present attendance grouped by organizationCode (using index [organizationCode, date])
      validOrgCodes.length > 0
        ? prisma.attendance.groupBy({
            by: ['organizationCode'],
            where: {
              organizationCode: { in: validOrgCodes },
              date: { gte: startPeriod, lte: endPeriod },
              finalRemark: { in: ['Present', 'Half Day', 'Clocked In', 'Regularized', 'Left Early', 'On Time', 'Late', 'Early Login'] }
            },
            _count: { id: true }
          })
        : [],

      // 4. Expenses sum grouped by organizationId
      prisma.expense.groupBy({
        by: ['organizationId'],
        where: {
          organizationId: { in: validOrgIds },
          status: { in: ['APPROVED', 'PAID'] },
          createdAt: { gte: startPeriod, lte: endPeriod }
        },
        _sum: { amount: true }
      })
    ]);

    // Build lookup maps for O(1) in-memory resolution
    const empStatsMap = new Map();
    employeeGroupStats.forEach(item => {
      empStatsMap.set(item.organizationId, {
        count: item._count.id || 0,
        salarySum: item._sum.salary || 0
      });
    });

    const totalAttMap = new Map();
    totalAttStats.forEach(item => {
      totalAttMap.set(item.organizationCode, item._count.id || 0);
    });

    const presentAttMap = new Map();
    presentAttStats.forEach(item => {
      presentAttMap.set(item.organizationCode, item._count.id || 0);
    });

    const expenseMap = new Map();
    expenseGroupStats.forEach(item => {
      expenseMap.set(item.organizationId, item._sum.amount || 0);
    });

    const companies = orgs.map((org, i) => {
      const empStat = empStatsMap.get(org.id) || { count: 0, salarySum: 0 };
      const employees = empStat.count > 0 ? empStat.count : (org.employeeCount || 0);

      const totalAttendance = totalAttMap.get(org.organizationCode) || 0;
      const presentAttendance = presentAttMap.get(org.organizationCode) || 0;

      const attendanceRate = totalAttendance > 0
        ? Math.min(100, Math.round((presentAttendance / totalAttendance) * 100))
        : 0;

      const rawSalary = empStat.salarySum || 0;
      const salaryNum = rawSalary > 0 ? parseFloat((rawSalary / 100000).toFixed(1)) : 0;
      const salaryCost = `₹${salaryNum}L`;

      const rawExpense = expenseMap.get(org.id) || 0;
      const expenseNum = rawExpense > 0 ? parseFloat((rawExpense / 100000).toFixed(1)) : 0;
      const expenses = `₹${expenseNum}L`;

      const growth = 0;
      const color = PALETTE[i % PALETTE.length];

      return {
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
      };
    });

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
