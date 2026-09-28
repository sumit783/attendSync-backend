const prisma = require('../prisma/client');
const cache = require('../utils/cache');

exports.getOverviewStats = async (req, res) => {
  // #swagger.tags = ['Dashboard']
  try {
    const organizationId = req.organizationId;

    // Cache overview stats per org for 60 seconds
    const cacheKey = `dashboard:overview:${organizationId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.status(200).json(cached);

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { organizationCode: true, inTime: true }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);

    // Run all three DB queries in parallel
    const [totalEmployees, attendances] = await Promise.all([
      prisma.employee.count({
        where: { organizationCode: organization.organizationCode }
      }),
      prisma.attendance.findMany({
        where: {
          organizationCode: organization.organizationCode,
          date: { gte: currentDate, lt: nextDate }
        },
        select: {
          sessions: {
            select: { clockInTime: true },
            orderBy: { clockInTime: 'asc' },
            take: 1
          },
          employee: {
            select: { shift: { select: { startTime: true } } }
          }
        }
      })
    ]);

    const present = attendances.length;
    const absent = Math.max(0, totalEmployees - present);

    // Calculate Late — use the first session clockInTime (already ordered)
    const orgInTimeStr = organization.inTime || '09:00';
    let late = 0;

    attendances.forEach(a => {
      if (!a.sessions || a.sessions.length === 0) return;
      const clockInDate = new Date(a.sessions[0].clockInTime);

      const expectedInTime = new Date(currentDate);
      const inTimeStr = a.employee?.shift?.startTime || orgInTimeStr;
      const [hours, minutes] = inTimeStr.split(':');
      expectedInTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      if (clockInDate > expectedInTime) {
        late++;
      }
    });

    const presentPercent = totalEmployees > 0 ? ((present / totalEmployees) * 100).toFixed(1) : '0.0';
    const absentPercent = totalEmployees > 0 ? ((absent / totalEmployees) * 100).toFixed(1) : '0.0';
    const latePercent = totalEmployees > 0 ? ((late / totalEmployees) * 100).toFixed(1) : '0.0';

    const result = { total: totalEmployees, present, absent, late, presentPercent, absentPercent, latePercent };
    cache.set(cacheKey, result, 60); // cache for 60 seconds

    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching overview stats:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getPayrollDistribution = async (req, res) => {
  // #swagger.tags = ['Dashboard']
  try {
    const organizationId = req.organizationId;

    // Cache payroll distribution per org for 5 minutes (salary data changes rarely)
    const cacheKey = `dashboard:payroll:${organizationId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.status(200).json(cached);

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { organizationCode: true }
    });

    if (!organization) return res.status(404).json({ message: 'Organization not found' });

    // Use select instead of include — only fetch what we need
    const employees = await prisma.employee.findMany({
      where: { organizationCode: organization.organizationCode },
      select: {
        salary: true,
        department: { select: { name: true } }
      }
    });

    const deptPayrollMap = new Map();
    let totalMonthlyPayroll = 0;

    employees.forEach(emp => {
      const deptName = emp.department?.name || 'General';
      const rawSal = Number(emp.salary ?? 0);
      const sal = isNaN(rawSal) || rawSal <= 0 ? 30000 : rawSal;

      totalMonthlyPayroll += sal;

      const current = deptPayrollMap.get(deptName) || { totalSalary: 0, count: 0 };
      deptPayrollMap.set(deptName, {
        totalSalary: current.totalSalary + sal,
        count: current.count + 1
      });
    });

    const PALETTE_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1', '#f97316'];

    const salaryPieData = Array.from(deptPayrollMap.entries()).map(([name, data], idx) => ({
      name,
      value: data.totalSalary,
      count: data.count,
      color: PALETTE_COLORS[idx % PALETTE_COLORS.length],
      percent: totalMonthlyPayroll > 0 ? Math.round((data.totalSalary / totalMonthlyPayroll) * 100) : 0,
    })).sort((a, b) => b.value - a.value);

    const result = { totalMonthlyPayroll, salaryPieData };
    cache.set(cacheKey, result, 300); // cache for 5 minutes

    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching payroll distribution:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getExpenseDistribution = async (req, res) => {
  // #swagger.tags = ['Dashboard']
  try {
    const organizationId = req.organizationId;
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { organizationCode: true }
    });

    if (!organization) return res.status(404).json({ message: 'Organization not found' });

    const expenses = await prisma.expense.findMany({
      where: { organizationCode: organization.organizationCode },
      select: { amount: true, type: true, status: true }
    });

    let totalExpenseAmount = 0;
    const categoryMap = new Map();
    const statusMap = new Map();
    const expenseStats = { PENDING: 0, APPROVED: 0, REJECTED: 0, PAID: 0 };

    expenses.forEach(item => {
      const amt = Number(item.amount || 0);
      const status = item.status || 'PENDING';
      if (expenseStats[status] !== undefined) expenseStats[status]++;

      // If expense claim is REJECTED, do not add it to totalExpenseAmount or active category claims
      if (status !== 'REJECTED') {
        totalExpenseAmount += amt;

        const cat = item.type || 'General';
        const catCurr = categoryMap.get(cat) || { amount: 0, count: 0 };
        categoryMap.set(cat, { amount: catCurr.amount + amt, count: catCurr.count + 1 });
      }

      // Map DB enum status to Pascal case for status breakdown
      const statusPascal = status.charAt(0) + status.slice(1).toLowerCase();
      const statCurr = statusMap.get(statusPascal) || { amount: 0, count: 0 };
      statusMap.set(statusPascal, { amount: statCurr.amount + amt, count: statCurr.count + 1 });
    });

    const PALETTE_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1', '#f97316'];
    const EXPENSE_STATUS_COLORS = { Approved: '#10b981', Pending: '#f59e0b', Paid: '#3b82f6', Rejected: '#ef4444', Other: '#94a3b8' };

    const expensePieDataCategory = Array.from(categoryMap.entries()).map(([name, data], idx) => ({
      name,
      value: data.amount,
      count: data.count,
      color: PALETTE_COLORS[idx % PALETTE_COLORS.length],
      percent: totalExpenseAmount > 0 ? Math.round((data.amount / totalExpenseAmount) * 100) : 0,
    })).sort((a, b) => b.value - a.value);

    const expensePieDataStatus = Array.from(statusMap.entries()).map(([name, data]) => ({
      name,
      value: data.amount,
      count: data.count,
      color: EXPENSE_STATUS_COLORS[name] || '#94a3b8',
      percent: totalExpenseAmount > 0 ? Math.round((data.amount / totalExpenseAmount) * 100) : 0,
    })).sort((a, b) => b.value - a.value);

    res.status(200).json({
      totalExpenseAmount,
      expenseStats,
      expensePieDataCategory,
      expensePieDataStatus
    });
  } catch (error) {
    console.error('Error fetching expense distribution:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};
