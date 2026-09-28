const express = require('express');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const requireOrganizationAccess = require('../middleware/requireOrganizationAccess');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { upload } = require('../config/cloudinary');
const prisma = require('../prisma/client');
const moment = require('moment-timezone');
const cache = require('../utils/cache');

const router = express.Router();

// ================== Register Office Wi-Fi ==================
router.post('/office-wifi', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
    // #swagger.tags = ['All Company']

  try {
    const organizationId = req.organizationId;
    const { wifiSSID, wifiBSSID, address, latitude, longitude } = req.body;

    if (!wifiSSID || !wifiBSSID) {
      return res.status(400).send({ message: 'WiFi SSID and BSSID are required.' });
    }

    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        wifiSSID,
        wifiBSSID,
        address,
        latitude: latitude ? parseFloat(latitude) : undefined,
        longitude: longitude ? parseFloat(longitude) : undefined,
      },
    });

    res.status(200).send({
      message: 'Office Wi-Fi registered successfully',
      organization: {
        wifiSSID: organization.wifiSSID,
        wifiBSSID: organization.wifiBSSID,
        address: organization.address,
        latitude: organization.latitude,
        longitude: organization.longitude
      }
    });
  } catch (error) {
    console.error('Error registering Wi-Fi:', error);
    res.status(500).send({ message: 'Internal Server Error', error: error.message });
  }
});

// ================== Update Auto Logout ==================
router.put('/update/:id', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
    // #swagger.tags = ['All Company']
    try {
        const targetOrgId = req.params.id;
        const adminOrgId = req.organizationId;
        const { autoLogout } = req.body;

        if (typeof autoLogout !== 'boolean') {
            return res.status(400).send({ message: 'autoLogout must be a boolean.' });
        }

        // Verify the target organization exists and belongs to the admin (either it's their own org or a child org)
        const targetOrg = await prisma.organization.findUnique({
            where: { id: targetOrgId }
        });

        if (!targetOrg) {
            return res.status(404).send({ message: 'Organization not found' });
        }

        // Allow update if the target org is the admin's org or a child of the admin's org
        if (targetOrg.id !== adminOrgId && targetOrg.parentId !== adminOrgId) {
            return res.status(403).send({ message: 'Forbidden: You do not have permission to update this organization.' });
        }

        const organization = await prisma.organization.update({
            where: { id: targetOrgId },
            data: { autoLogout }
        });

        res.status(200).send({
            message: 'Auto Logout setting updated successfully.',
            autoLogout: organization.autoLogout
        });
    } catch (error) {
        console.error('Error updating auto logout:', error);
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
});

// ================== Get All Employees for an Organization ==================
router.get('/employees', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
    // #swagger.tags = ['All Company']

  try {
    const { page = 1, limit = 10, search, status } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId },
      select: { organizationCode: true, inTime: true }
    });

    if (!organization) {
      return res.status(404).send({ message: 'Organization not found' });
    }

    const orgCode = organization.organizationCode;
    const orgInTimeStr = organization.inTime || '09:00';
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);

    // Parallelise attendance + leave lookups (needed for stats + status derivation)
    const [attendances, approvedLeaves] = await Promise.all([
      prisma.attendance.findMany({
        where: { organizationCode: orgCode, date: { gte: currentDate, lt: nextDate } },
        select: {
          employeeId: true,
          sessions: {
            select: { clockInTime: true },
            orderBy: { clockInTime: 'asc' },
            take: 1
          }
        }
      }),
      prisma.leave.findMany({
        where: {
          organizationCode: orgCode,
          status: 'Approved',
          startDate: { lt: nextDate },
          endDate: { gte: currentDate }
        },
        select: { employeeId: true }
      })
    ]);

    const attendanceByEmpId = new Map(attendances.map(a => [a.employeeId, a]));
    const onLeaveEmpIds = new Set(approvedLeaves.map(l => l.employeeId));

    // Base where clause — simplified: use organizationCode directly (no slow history OR)
    const baseWhere = { organizationCode: orgCode };
    if (search) {
      baseWhere.OR = [
        { employeeName: { contains: search } },
        { employeeEmail: { contains: search } }
      ];
    }

    const employeeSelect = {
      id: true,
      employeeName: true,
      employeeEmail: true,
      profilePic: true,
      salary: true,
      status: true,
      shift: { select: { id: true, name: true, startTime: true, endTime: true, weekOffs: true } },
      department: { select: { id: true, name: true } },
      customRole: { select: { id: true, name: true } },
      designations: { select: { id: true, name: true } }
    };

    const isEmpLate = (emp) => {
      const att = attendanceByEmpId.get(emp.id);
      if (!att || !att.sessions || att.sessions.length === 0) return false;
      const firstSession = att.sessions[0];
      if (!firstSession.clockInTime) return false;

      const clockInDate = new Date(firstSession.clockInTime);
      const inTimeStr = emp.shift?.startTime || orgInTimeStr;
      const [hours, minutes] = inTimeStr.split(':');
      const expectedInTime = new Date(currentDate);
      expectedInTime.setHours(parseInt(hours || '9'), parseInt(minutes || '0'), 0, 0);
      return clockInDate > expectedInTime;
    };

    const deriveStatus = (emp) => {
      if (emp.status === 'inactive') return 'Inactive';
      if (attendanceByEmpId.has(emp.id)) {
        if (isEmpLate(emp)) return 'Late';
        return 'Present';
      }
      if (onLeaveEmpIds.has(emp.id)) return 'On Leave';
      return 'Absent';
    };

    // Load IDs + shift info for all employees matching search criteria
    const allEmpInfo = await prisma.employee.findMany({
      where: baseWhere,
      select: {
        id: true,
        status: true,
        shift: { select: { startTime: true } }
      }
    });

    // Compute derived status for each employee
    const withStatus = allEmpInfo.map(emp => ({
      id: emp.id,
      derivedStatus: deriveStatus(emp)
    }));

    // Stats across all employees
    const stats = {
      total: withStatus.length,
      present: withStatus.filter(e => e.derivedStatus === 'Present' || e.derivedStatus === 'Late').length,
      late: withStatus.filter(e => e.derivedStatus === 'Late').length,
      absent: withStatus.filter(e => e.derivedStatus === 'Absent').length,
      onleave: withStatus.filter(e => e.derivedStatus === 'On Leave').length
    };

    // Determine matching IDs based on filter
    let matchingIds = withStatus.map(e => e.id);
    if (status && status !== 'All') {
      const targetStatus = status.toLowerCase();
      matchingIds = withStatus
        .filter(e => {
          if (targetStatus === 'present') return e.derivedStatus === 'Present' || e.derivedStatus === 'Late';
          return e.derivedStatus.toLowerCase() === targetStatus;
        })
        .map(e => e.id);
    }

    const total = matchingIds.length;
    const pageIds = matchingIds.slice(skip, skip + limitNum);

    if (pageIds.length === 0) {
      return res.status(200).send({
        employees: [],
        stats,
        pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 }
      });
    }

    // Fetch full data only for the current page IDs
    const pageEmployees = await prisma.employee.findMany({
      where: { id: { in: pageIds } },
      select: employeeSelect,
      orderBy: { employeeName: 'asc' }
    });

    const enriched = pageEmployees.map(emp => ({
      ...emp,
      status: deriveStatus(emp),
      isLate: isEmpLate(emp)
    }));

    res.status(200).send({
      employees: enriched,
      stats,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) }
    });
  } catch (error) {
    console.error('Error in /organization/employees:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Present Employees in the Organization ==================
router.get('/present-employees', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
    // #swagger.tags = ['All Company']

  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const presentEmployees = await prisma.attendance.findMany({
      where: {
        organizationCode: organization.organizationCode,
        date: { gte: currentDate, lt: nextDate },
        sessions: {
          some: {
            clockOutTime: null
          }
        }
      },
      select: {
        employeeName: true,
        sessions: {
          take: 1,
          orderBy: { clockInTime: 'asc' },
          select: { clockInTime: true }
        }
      },
      skip,
      take: limit
    });

    const totalPresent = await prisma.attendance.count({
      where: {
        organizationCode: organization.organizationCode,
        date: { gte: currentDate, lt: nextDate },
        sessions: {
          some: {
            clockOutTime: null
          }
        }
      }
    });

    if (presentEmployees.length === 0) {
      return res.status(200).send({ message: 'No employees are currently present.' });
    }

    const formattedEmployees = presentEmployees.map(emp => ({
      employeeName: emp.employeeName,
      clockInTime: emp.sessions[0]?.clockInTime
    }));

    res.status(200).send({
      message: 'Present employees retrieved successfully.',
      totalPresent,
      page,
      totalPages: Math.ceil(totalPresent / limit),
      presentEmployees: formattedEmployees
    });
  } catch (error) {
    console.error('Error in /present-employees:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Reset Employee Device ==================

/**
 * @swagger
 * /api/organization/employees:
 *   get:
 *     summary: Get all employees with filtering and pagination
 *     tags: [All Company]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name or email
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [All, Present, Absent, On Leave, Inactive, Week Off]
 *         description: Filter by dynamic attendance status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: List of employees with stats and pagination
 * 
 *   post:
 *     summary: Create an employee (Admin only)
 *     tags: [All Company]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - employeeName
 *               - employeeEmail
 *               - password
 *             properties:
 *               employeeName:
 *                 type: string
 *               employeeEmail:
 *                 type: string
 *               password:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [Employee, Manager, Admin]
 *               shiftId:
 *                 type: string
 *               departmentId:
 *                 type: string
 *               designationIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               customRoleId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Employee created successfully
 *       400:
 *         description: Invalid input or employee already exists
 */
router.post('/employees', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
    // #swagger.tags = ['All Company']

  try {
    const { 
      employeeName, 
      employeeEmail, 
      password, 
      role, 
      shiftId, 
      departmentId, 
      designationIds, 
      customRoleId,
      salary
    } = req.body;

    if (!employeeName || !employeeEmail || !password) {
      return res.status(400).send({ message: 'Employee name, email, and password are required' });
    }

    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId }
    });

    if (!organization) {
      return res.status(404).send({ message: 'Organization not found' });
    }

    const existingEmployee = await prisma.employee.findUnique({
      where: { employeeEmail }
    });

    if (existingEmployee) {
      return res.status(400).send({ message: 'Employee with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newEmployee = await prisma.employee.create({
      data: {
        employeeName,
        employeeEmail,
        password: hashedPassword,
        organizationId: organization.id,
        organizationCode: organization.organizationCode,
        isVerified: true, 
        role: role || 'Employee',
        shiftId: shiftId || null,
        departmentId: departmentId || null,
        customRoleId: customRoleId || null,
        salary: salary ? parseFloat(salary) : 0,
        designations: designationIds && designationIds.length > 0 ? {
          connect: designationIds.map(id => ({ id }))
        } : undefined,
      }
    });

    // Add employment history for joining
    await prisma.employmentHistory.create({
      data: {
        employeeId: newEmployee.id,
        organizationCode: organization.organizationCode,
        status: 'active'
      }
    });

    // update org employee count
    await prisma.organization.update({
        where: { id: organization.id },
        data: { employeeCount: { increment: 1 } }
    });

    res.status(201).send({ message: 'Employee created successfully', employee: newEmployee });
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Reset Employee Device ==================
router.post('/employees/:employeeId/reset-device', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
    // #swagger.tags = ['All Company']

  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const employeeId = req.params.employeeId;

    const employee = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        organizationCode: organization.organizationCode
      }
    });

    if (!employee) return res.status(404).send({ message: 'Employee not found' });

    await prisma.employeeDevice.updateMany({
      where: {
        employeeId: employee.id,
        status: 'ACTIVE'
      },
      data: {
        status: 'REVOKED'
      }
    });

    res.status(200).send({ message: 'Employee devices reset successfully.' });
  } catch (error) {
    console.error('Error in /reset-device:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Update an Employee ==================
/**
 * @swagger
 * /api/organization/employees/{employeeId}:
 *   put:
 *     summary: Update an employee (Admin only)
 *     tags: [All Company]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the employee to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               employeeName:
 *                 type: string
 *               employeeEmail:
 *                 type: string
 *               password:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [Employee, Manager, Admin]
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *               salary:
 *                 type: number
 *               shiftId:
 *                 type: string
 *                 nullable: true
 *               departmentId:
 *                 type: string
 *                 nullable: true
 *               customRoleId:
 *                 type: string
 *                 nullable: true
 *               designationIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               profilePic:
 *                 type: string
 *               isVerified:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Employee updated successfully
 *       400:
 *         description: Invalid input or email already in use
 *       404:
 *         description: Employee not found
 */
const updateEmployeeHandler = async (req, res) => {
  // #swagger.tags = ['All Company']
  try {
    const organizationId = req.organizationId;
    const employeeId = req.params.employeeId || req.params.id;

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId }
    });

    if (!organization) {
      return res.status(404).send({ message: 'Organization not found' });
    }

    const existingEmployee = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        OR: [
          { organizationId: organization.id },
          { organizationCode: organization.organizationCode }
        ]
      }
    });

    if (!existingEmployee) {
      return res.status(404).send({ message: 'Employee not found in your organization' });
    }

    const {
      employeeName,
      employeeEmail,
      password,
      role,
      status,
      salary,
      shiftId,
      departmentId,
      customRoleId,
      designationIds,
      profilePic,
      isVerified
    } = req.body;

    // Check if email is changing and already in use
    if (employeeEmail && employeeEmail.toLowerCase() !== existingEmployee.employeeEmail.toLowerCase()) {
      const emailInUse = await prisma.employee.findUnique({
        where: { employeeEmail }
      });
      if (emailInUse) {
        return res.status(400).send({ message: 'Employee with this email already exists' });
      }
    }

    const updateData = {};

    if (employeeName !== undefined) updateData.employeeName = employeeName;
    if (employeeEmail !== undefined) updateData.employeeEmail = employeeEmail;
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }
    if (role !== undefined) updateData.role = role;
    if (status !== undefined) updateData.status = status;
    if (profilePic !== undefined) updateData.profilePic = profilePic;
    if (salary !== undefined) updateData.salary = salary !== null ? parseFloat(salary) : 0;
    if (isVerified !== undefined) updateData.isVerified = Boolean(isVerified);

    if (shiftId !== undefined) {
      updateData.shiftId = shiftId || null;
    }
    if (departmentId !== undefined) {
      updateData.departmentId = departmentId || null;
    }
    if (customRoleId !== undefined) {
      updateData.customRoleId = customRoleId || null;
    }
    if (designationIds !== undefined && Array.isArray(designationIds)) {
      updateData.designations = {
        set: designationIds.map(id => ({ id }))
      };
    }

    const updatedEmployee = await prisma.employee.update({
      where: { id: employeeId },
      data: updateData,
      include: {
        department: { select: { id: true, name: true } },
        customRole: { select: { id: true, name: true } },
        shift: { select: { id: true, name: true, startTime: true, endTime: true, weekOffs: true } },
        designations: { select: { id: true, name: true } }
      }
    });

    // Record status change in employment history if status was updated
    if (status && status !== existingEmployee.status) {
      await prisma.employmentHistory.create({
        data: {
          employeeId,
          organizationCode: organization.organizationCode,
          status,
          ...(status === 'inactive' ? { leftAt: new Date() } : {})
        }
      });
    }

    const { password: _, ...employeeResponse } = updatedEmployee;

    res.status(200).send({
      message: 'Employee updated successfully',
      employee: employeeResponse
    });
  } catch (error) {
    console.error('Error updating employee:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
};

router.put('/employees/:employeeId', authenticateAdmin, requireOrganizationAccess, updateEmployeeHandler);
router.put('/employee/:employeeId', authenticateAdmin, requireOrganizationAccess, updateEmployeeHandler);

// ================== Delete an Employee ==================
const deleteEmployeeHandler = async (req, res) => {
    // #swagger.tags = ['All Company']

  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const employeeId = req.params.employeeId || req.params.id;

    const employee = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        organizationCode: organization.organizationCode,
      }
    });

    if (!employee) return res.status(404).send({ message: 'Employee not found in your organization' });

    await prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { status: 'inactive' }
      });

      await tx.employmentHistory.create({
        data: {
          employeeId: employeeId,
          organizationCode: organization.organizationCode,
          status: 'inactive',
          leftAt: new Date()
        }
      });
    });

    res.status(200).send({ message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('Error in delete employee:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
};

router.delete('/employee/:employeeId', authenticateAdmin, requireOrganizationAccess, deleteEmployeeHandler);
router.delete('/employees/:employeeId', authenticateAdmin, requireOrganizationAccess, deleteEmployeeHandler);


// ================== Get Employees Status (Present, Late, Early Leavers) ==================
router.get('/employees-status', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
    // #swagger.tags = ['All Company']

  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId },
      select: { organizationCode: true, inTime: true, outTime: true }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);
    const currentDayName = currentDate.toLocaleDateString('en-US', { weekday: 'long' });

    const orgCode = organization.organizationCode;
    const orgInTimeStr = organization.inTime || '09:00';
    const orgOutTimeStr = organization.outTime || '18:00';

    const [employees, attendances, approvedLeaves] = await Promise.all([
      prisma.employee.findMany({
        where: { organizationCode: orgCode },
        select: {
          id: true,
          employeeName: true,
          employeeEmail: true,
          profilePic: true,
          status: true,
          shift: { select: { startTime: true, endTime: true, weekOffs: true } }
        }
      }),
      prisma.attendance.findMany({
        where: {
          organizationCode: orgCode,
          date: { gte: currentDate, lt: nextDate }
        },
        select: {
          employeeId: true,
          // Only fetch the first and last session time — avoids loading full session rows
          sessions: {
            select: { clockInTime: true, clockOutTime: true },
            orderBy: { clockInTime: 'asc' }
          }
        }
      }),
      prisma.leave.findMany({
        where: {
          organizationCode: orgCode,
          status: 'Approved',
          startDate: { lt: nextDate },
          endDate: { gte: currentDate }
        },
        select: { employeeId: true }
      })
    ]);

    // Build lookup maps — O(1) access instead of Array.find/includes
    const onLeaveEmpIds = new Set(approvedLeaves.map(l => l.employeeId));
    const attendanceByEmpId = new Map(attendances.map(a => [a.employeeId, a]));
    const employeeById = new Map(employees.map(e => [e.id, e]));

    let filteredEmployees = [];
    const filter = req.query.filter ? req.query.filter.toLowerCase() : '';

    if (filter === 'present') {
      filteredEmployees = employees.filter(emp => attendanceByEmpId.has(emp.id));
    } else if (filter === 'late') {
      filteredEmployees = employees.filter(emp => {
        const att = attendanceByEmpId.get(emp.id);
        if (!att || !att.sessions || att.sessions.length === 0) return false;
        const firstSession = att.sessions[0]; // already ordered asc
        const clockInDate = new Date(firstSession.clockInTime);
        const inTimeStr = emp.shift?.startTime || orgInTimeStr;
        const [hours, minutes] = inTimeStr.split(':');
        const expectedInTime = new Date(currentDate);
        expectedInTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        return clockInDate > expectedInTime;
      });
    } else if (filter === 'earlyleavers') {
      filteredEmployees = employees.filter(emp => {
        const att = attendanceByEmpId.get(emp.id);
        if (!att || !att.sessions || att.sessions.length === 0) return false;
        const lastSession = att.sessions[att.sessions.length - 1];
        if (!lastSession.clockOutTime) return false;
        const clockOutDate = new Date(lastSession.clockOutTime);
        const outTimeStr = emp.shift?.endTime || orgOutTimeStr;
        const [hours, minutes] = outTimeStr.split(':');
        const expectedOutTime = new Date(currentDate);
        expectedOutTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        return clockOutDate < expectedOutTime;
      });
    } else {
      filteredEmployees = employees.map(emp => {
        const isPresent = attendanceByEmpId.has(emp.id);
        const isOnLeave = onLeaveEmpIds.has(emp.id);

        let status = isPresent ? 'Present' : 'Absent';
        if (!isPresent) {
          if (isOnLeave) {
            status = 'On Leave';
          } else if (emp.shift?.weekOffs?.includes(currentDayName)) {
            status = 'Week Off';
          }
        }
        return { ...emp, status };
      });
    }

    res.status(200).send({ filteredEmployees });
  } catch (error) {
    console.error('Error in /employees-status:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});


// ================== Employee Performance Report ==================

/**
 * @swagger
 * /api/organization/employees/{employeeId}/performance-report:
 *   get:
 *     summary: Get real performance report for an employee (last 6 months + current month)
 *     tags: [All Company]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Performance report with scores, monthly hours, and activity summary
 *       404:
 *         description: Employee not found
 */
router.get('/employees/:employeeId/performance-report', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
  // #swagger.tags = ['All Company']
  try {
    const { employeeId } = req.params;

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId: req.organizationId },
      select: {
        id: true,
        employeeName: true,
        employeeEmail: true,
        profilePic: true,
        organizationCode: true,
        shift: { select: { name: true, startTime: true, endTime: true, weekOffs: true } }
      }
    });

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found in this organization.' });
    }

    // ── Date range configuration ───────────────────────────────────────
    const { range, startDate, endDate } = req.query;
    const now = moment().tz('Asia/Kolkata');
    let rangeStart, rangeEnd;

    if (range === 'currentMonth') {
      rangeStart = now.clone().startOf('month').toDate();
      rangeEnd = now.clone().endOf('month').toDate();
    } else if (range === 'lastMonth') {
      rangeStart = now.clone().subtract(1, 'month').startOf('month').toDate();
      rangeEnd = now.clone().subtract(1, 'month').endOf('month').toDate();
    } else if (range === 'last3Months') {
      rangeStart = now.clone().subtract(2, 'months').startOf('month').toDate();
      rangeEnd = now.clone().endOf('month').toDate();
    } else if (range === 'custom' && startDate && endDate) {
      rangeStart = moment(startDate).startOf('day').toDate();
      rangeEnd = moment(endDate).endOf('day').toDate();
    } else {
      // Default: last 6 months
      rangeStart = now.clone().subtract(5, 'months').startOf('month').toDate();
      rangeEnd = now.clone().endOf('month').toDate();
    }

    // ── Fetch all attendance in range ─────────────────────────────────
    const attendances = await prisma.attendance.findMany({
      where: {
        employeeId,
        organizationCode: employee.organizationCode,
        date: { gte: rangeStart, lte: rangeEnd }
      },
      select: { date: true, totalHours: true, extraHours: true, finalRemark: true, sessions: { orderBy: { clockInTime: 'asc' }, select: { clockInTime: true } } },
      orderBy: { date: 'asc' }
    });

    // ── Fetch tasks ────────────────────────────────────────────────────
    const [totalTasks, completedTasks] = await Promise.all([
      prisma.task.count({ where: { employeeId, organizationId: req.organizationId } }),
      prisma.task.count({ where: { employeeId, organizationId: req.organizationId, status: 'COMPLETED' } })
    ]);

    // ── Fetch leaves this period ───────────────────────────────────────
    const approvedLeaves = await prisma.leave.count({
      where: { employeeId, organizationCode: employee.organizationCode, status: 'Approved', startDate: { gte: rangeStart } }
    });

    // ── Build monthly hours breakdown ──────────────────────────────────
    const monthlyMap = {};
    let m = moment(rangeStart).startOf('month');
    const mEnd = moment(rangeEnd).endOf('month');
    
    while (m.isSameOrBefore(mEnd)) {
      const key = m.format('YYYY-MM');
      monthlyMap[key] = { month: m.format('MMM'), hours: 0, present: 0, late: 0 };
      m.add(1, 'month');
    }

    const PRESENT_REMARKS = ['Present', 'Half Day', 'Left Early', 'Clocked In', 'Regularized'];
    let totalHoursAll = 0;
    let totalOvertimeAll = 0;
    let lateArrivals = 0;
    let earlyDepartures = 0;
    let presentDays = 0;

    // Determine shift start for punctuality check
    const shiftStartParts = employee.shift?.startTime ? employee.shift.startTime.split(':').map(Number) : null;

    for (const a of attendances) {
      const mKey = moment(a.date).format('YYYY-MM');
      if (!monthlyMap[mKey]) continue;

      const dayHours = Math.max(0, a.totalHours || 0);
      const dayOvertime = Math.max(0, a.extraHours || 0);

      monthlyMap[mKey].hours += dayHours;
      totalHoursAll += dayHours;
      totalOvertimeAll += dayOvertime;

      if (PRESENT_REMARKS.includes(a.finalRemark)) {
        presentDays++;
        monthlyMap[mKey].present++;

        // Punctuality: check if first clock-in was after shift start
        if (shiftStartParts && a.sessions.length > 0) {
          const clockIn = moment(a.sessions[0].clockInTime).tz('Asia/Kolkata');
          const shiftStartMins = shiftStartParts[0] * 60 + shiftStartParts[1];
          const clockInMins = clockIn.hours() * 60 + clockIn.minutes();
          // Grace period: 10 minutes
          if (clockInMins > shiftStartMins + 10) {
            lateArrivals++;
            monthlyMap[mKey].late++;
          }
        }
      }

      if (a.finalRemark === 'Left Early') earlyDepartures++;
    }

    // ── Calculate True Absent Days (Handling missing data) ────────────
    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId },
      select: { holidays: { where: { startDate: { lte: rangeEnd }, endDate: { gte: rangeStart } }, select: { startDate: true, endDate: true } } }
    });

    const holidayDates = new Set();
    for (const h of (organization?.holidays || [])) {
      let d = moment(h.startDate);
      const end = moment(h.endDate);
      while (d.isSameOrBefore(end, 'day')) {
        holidayDates.add(d.format('YYYY-MM-DD'));
        d.add(1, 'day');
      }
    }

    const attendanceMap = {};
    for (const a of attendances) {
      attendanceMap[moment(a.date).format('YYYY-MM-DD')] = a.finalRemark;
    }

    let expectedWorkingDays = 0;
    let absentDays = 0;
    const today = now.clone().startOf('day');
    const weekOffNames = employee.shift?.weekOffs
      ? employee.shift.weekOffs.split(',').map(d => d.trim().toLowerCase())
      : [];

    let currentDay = moment(rangeStart);
    const maxDay = moment.min(moment(rangeEnd), today); // Don't count future days

    while (currentDay.isSameOrBefore(maxDay, 'day')) {
      const dateStr = currentDay.format('YYYY-MM-DD');
      const dayName = currentDay.format('dddd').toLowerCase();

      // If not weekoff and not holiday
      if (!weekOffNames.includes(dayName) && !holidayDates.has(dateStr)) {
        expectedWorkingDays++;
        
        const remark = attendanceMap[dateStr];
        // If there's no record, or the record says Absent, it's an absent day
        // (Assuming approved leaves might have a 'Leave' remark, but if not, they'll be counted as absent here unless we cross-check leaves. 
        // For now, matching the finance summary logic which only looks at PRESENT_REMARKS).
        if (!remark || !PRESENT_REMARKS.includes(remark)) {
          absentDays++;
        }
      }
      currentDay.add(1, 'day');
    }

    // ── Calculate scores ───────────────────────────────────────────────
    const avgDailyHours = presentDays > 0 ? Math.max(0, parseFloat((totalHoursAll / presentDays).toFixed(2))) : 0;
    const overtimeHours = Math.max(0, parseFloat(totalOvertimeAll.toFixed(2)));

    // Punctuality score: (present - late) / present * 100
    const punctualityScore = presentDays > 0
      ? Math.round(((presentDays - lateArrivals) / presentDays) * 100)
      : 0;

    // Task completion score
    const taskScore = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Attendance score (present days out of expected working days)
    const attendanceScore = expectedWorkingDays > 0 
      ? Math.max(0, Math.round(((expectedWorkingDays - absentDays) / expectedWorkingDays) * 100))
      : 0;

    // Overtime score: capped at 100, based on avg overtime vs expected hours (generous scoring)
    const avgOvertimePerDay = presentDays > 0 ? totalOvertimeAll / presentDays : 0;
    const overtimeScore = Math.min(100, Math.round(avgOvertimePerDay * 25)); // 4hr+ overtime = 100

    // Consistency: low late arrivals + low early departures
    const consistencyScore = presentDays > 0
      ? Math.max(0, Math.round(100 - ((lateArrivals + earlyDepartures) / presentDays) * 100))
      : 0;

    // Absenteeism rate (% of working days absent over the range)
    const absenteeismRate = expectedWorkingDays > 0 ? parseFloat(((absentDays / expectedWorkingDays) * 100).toFixed(1)) : 0;

    // Overall score: weighted average
    const overallScore = Math.round(
      punctualityScore * 0.30 +
      attendanceScore  * 0.25 +
      taskScore        * 0.25 +
      consistencyScore * 0.20
    );

    const monthlyHours = Object.values(monthlyMap).map(m => ({
      month: m.month,
      hours: Math.max(0, parseFloat(m.hours.toFixed(1))),
      presentDays: m.present,
      lateDays: m.late
    }));

    return res.status(200).json({
      employee: {
        id: employee.id,
        employeeName: employee.employeeName,
        employeeEmail: employee.employeeEmail,
        profilePic: employee.profilePic,
        shift: employee.shift?.name || null
      },
      scores: {
        overall: overallScore,
        punctuality: punctualityScore,
        attendance: attendanceScore,
        taskCompletion: taskScore,
        overtime: overtimeScore,
        consistency: consistencyScore
      },
      kpis: {
        avgDailyHours,
        overtimeHours,
        absenteeismRate,
        lateArrivals,
        earlyDepartures,
        presentDays,
        absentDays,
        approvedLeaves
      },
      tasks: {
        total: totalTasks,
        completed: completedTasks,
        pending: totalTasks - completedTasks
      },
      monthlyHours
    });
  } catch (error) {
    console.error('Error fetching performance report:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ================== Get Employee Details ==================

router.get('/employee-details/:employeeId', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
    // #swagger.tags = ['All Company']

  try {
    const { employeeId } = req.params;

    // ── Fetch org + employee details in parallel ──────────────────────
    const [organization, employeeDetails] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: req.organizationId },
        select: { organizationCode: true }
      }),
      prisma.employee.findUnique({
        where: { id: employeeId },
        select: { employeeName: true, profilePic: true, shift: true }
      })
    ]);

    if (!organization) {
      return res.status(404).send({ message: 'Organization not found' });
    }
    if (!employeeDetails) {
      return res.status(404).send({ message: 'Employee not found' });
    }

    const orgCode = organization.organizationCode;

    // Limit attendance to last 12 months to avoid fetching years of data
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    // ── Run all 3 remaining queries in parallel ───────────────────────
    const [leaveGroups, attendanceRecords, approvedLeaveRecords] = await Promise.all([
      // Single groupBy replaces 3 separate leave.count() calls
      prisma.leave.groupBy({
        by: ['status'],
        where: { employeeId, organizationCode: orgCode },
        _count: { id: true }
      }),
      prisma.attendance.findMany({
        where: {
          employeeId,
          organizationCode: orgCode,
          date: { gte: twelveMonthsAgo }
        },
        select: {
          date: true,
          totalHours: true,
          finalRemark: true,
          sessions: {
            orderBy: { clockInTime: 'asc' },
            select: { clockInTime: true, clockOutTime: true }
          }
        }
      }),
      prisma.leave.findMany({
        where: {
          employeeId,
          organizationCode: orgCode,
          status: 'Approved',
          endDate: { gte: twelveMonthsAgo }
        },
        select: { startDate: true, endDate: true, leaveType: true }
      })
    ]);

    // Derive leave stats from grouped result
    const leaveStatMap = Object.fromEntries(leaveGroups.map(g => [g.status, g._count.id]));
    const totalLeaves = leaveGroups.reduce((sum, g) => sum + g._count.id, 0);
    const approvedLeaves = leaveStatMap['Approved'] || 0;
    const rejectedLeaves = leaveStatMap['Rejected'] || 0;

    // Build attendance calendar
    const calendar = {};

    attendanceRecords.forEach(record => {
      const dateStr = moment(record.date).tz('Asia/Kolkata').format('YYYY-MM-DD');
      const firstSession = record.sessions.length > 0 ? record.sessions[0] : null;
      const lastSession = record.sessions.length > 0 ? record.sessions[record.sessions.length - 1] : null;
      calendar[dateStr] = {
        status: record.finalRemark,
        clockInTime: firstSession ? firstSession.clockInTime : null,
        clockOutTime: lastSession ? lastSession.clockOutTime : null,
        totalHours: record.totalHours,
      };
    });

    approvedLeaveRecords.forEach(leaveRecord => {
      const currentDate = moment(leaveRecord.startDate).tz('Asia/Kolkata').startOf('day');
      const endDate = moment(leaveRecord.endDate).tz('Asia/Kolkata').startOf('day');
      while (currentDate.isSameOrBefore(endDate)) {
        const dateString = currentDate.format('YYYY-MM-DD');
        calendar[dateString] = {
          status: 'Leave',
          leaveType: leaveRecord.leaveType,
          clockInTime: null,
          clockOutTime: null,
          totalHours: null,
        };
        currentDate.add(1, 'days');
      }
    });

    res.status(200).send({
      employeeDetails: {
        name: employeeDetails.employeeName,
        profilePic: employeeDetails.profilePic,
        shift: employeeDetails.shift,
      },
      leaveStatistics: { totalLeaves, approvedLeaves, rejectedLeaves },
      attendanceCalendar: calendar,
    });
  } catch (error) {
    console.error('Error in /employee-details:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Export Attendance Data ==================
router.get('/export-attendance', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
    // #swagger.tags = ['All Company']

  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const { startDate, endDate } = req.query;
    
    const start = startDate ? moment(startDate).tz('Asia/Kolkata').startOf('day') : moment().tz('Asia/Kolkata').startOf('month');
    const end = endDate ? moment(endDate).tz('Asia/Kolkata').endOf('day') : moment().tz('Asia/Kolkata').endOf('month');
    const today = moment().tz('Asia/Kolkata').endOf('day');
    const actualEnd = end.isAfter(today) ? today : end;

    const employees = await prisma.employee.findMany({
      where: {
        OR: [
          { organizationId: organization.id },
          { organizationCode: organization.organizationCode },
          { history: { some: { organizationCode: organization.organizationCode } } }
        ]
      },
      include: {
        shift: true,
        department: { select: { name: true } },
        history: {
          where: { organizationCode: organization.organizationCode },
          orderBy: { leftAt: 'desc' },
          take: 1
        }
      }
    });

    const empIds = employees.map(e => e.id);

    const [attendances, approvedLeaves, holidays] = await Promise.all([
      prisma.attendance.findMany({
        where: {
          OR: [
            { employeeId: { in: empIds } },
            { organizationCode: organization.organizationCode }
          ],
          date: { gte: start.toDate(), lte: actualEnd.toDate() }
        },
        include: {
          sessions: { orderBy: { clockInTime: 'asc' } }
        }
      }),
      prisma.leave.findMany({
        where: {
          OR: [
            { employeeId: { in: empIds } },
            { organizationCode: organization.organizationCode }
          ],
          status: 'Approved',
          startDate: { lte: actualEnd.toDate() },
          endDate: { gte: start.toDate() }
        }
      }),
      prisma.holiday.findMany({
        where: {
          organizationId: organization.id,
          startDate: { lte: actualEnd.toDate() },
          endDate: { gte: start.toDate() }
        }
      })
    ]);

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

    const exportData = [];
    const employeeSummary = {};

    const orgInTimeStr = organization.inTime || '09:00';
    const orgOutTimeStr = organization.outTime || '18:00';

    for (let m = start.clone(); m.isSameOrBefore(actualEnd); m.add(1, 'days')) {
      const currentDayName = m.format('dddd');
      const currentDateStr = m.format('YYYY-MM-DD');
      
      employees.forEach(emp => {
        const email = emp.employeeEmail || 'unknown';
        if (!employeeSummary[email]) {
          employeeSummary[email] = {
            EmployeeName: emp.employeeName,
            Email: email,
            Organization: organization.organizationName,
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

        const attendance = attendances.find(a => a.employeeId === emp.id && moment(a.date).tz('Asia/Kolkata').format('YYYY-MM-DD') === currentDateStr);
        const isOnLeave = approvedLeaves.some(l => l.employeeId === emp.id && moment(l.startDate).tz('Asia/Kolkata').startOf('day').isSameOrBefore(m) && moment(l.endDate).tz('Asia/Kolkata').endOf('day').isSameOrAfter(m));
        const isHoliday = holidays.some(h => moment(h.startDate).tz('Asia/Kolkata').startOf('day').isSameOrBefore(m) && moment(h.endDate).tz('Asia/Kolkata').endOf('day').isSameOrAfter(m));
        const isWeekOff = emp.shift && emp.shift.weekOffs && emp.shift.weekOffs.includes(currentDayName);

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

          // Format full date & time for Login and Logout
          loginTime = firstSession.clockInTime ? moment(firstSession.clockInTime).tz('Asia/Kolkata').format('YYYY-MM-DD hh:mm A') : 'N/A';
          logoutTime = lastSession.clockOutTime ? moment(lastSession.clockOutTime).tz('Asia/Kolkata').format('YYYY-MM-DD hh:mm A') : 'N/A';

          // Robust calculation of total working hours across all sessions (handles cross-midnight accurately)
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

          // Use attendance.totalHours if positive and matches session math, otherwise use calculatedSessionHours
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
          } else if (isLate && isEarlyLeave) status = 'Late Login & Early Leave';
          else if (isLate) status = 'Late Login';
          else if (isEarlyLeave) status = 'Early Leave';
          else status = 'On Time';

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
          'Employee Name': emp.employeeName,
          'Email': email,
          'Organization': organization.organizationName,
          'Department': emp.department?.name || 'Unassigned',
          'Date': currentDateStr,
          'Login Date & Time': loginTime,
          'Logout Date & Time': logoutTime,
          'Late Login': isLateLogin,
          'Early Logout': isEarlyLogout,
          'Total Hours (HH:MM)': formatHoursToHHMM(totalHours),
          'Extra Hours (HH:MM)': formatHoursToHHMM(extraHours),
          'Status': status
        });
      });
    }

    exportData.sort((a, b) => new Date(b.Date) - new Date(a.Date)); // sort by date descending

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

    res.status(200).send({ exportData, summaryData });
  } catch (error) {
    console.error('Error exporting attendance:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Bulk Attendance Upload from Excel ==================
router.post('/bulk-attendance', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
  // #swagger.tags = ['All Company']
  try {
    const { records } = req.body; // Array of { employeeName, inDate, inTime, outDate, outTime, finalRemark }
    const organizationId = req.organizationId;

    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).send({ message: 'records array is required and must not be empty.' });
    }

    const organization = req.targetOrganization || await prisma.organization.findUnique({
      where: { id: organizationId }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    // Fetch all employees of this org once for name matching
    const employees = await prisma.employee.findMany({
      where: { organizationCode: organization.organizationCode },
      include: { shift: true }
    });

    // Build case-insensitive name map
    const employeeMap = new Map();
    for (const emp of employees) {
      employeeMap.set(emp.employeeName.toLowerCase().trim(), emp);
    }

    const results = [];

    for (const record of records) {
      const { employeeName, inDate, inTime, outDate, outTime, finalRemark: customRemark } = record;

      if (!employeeName || !inDate) {
        results.push({ employeeName, status: 'error', message: 'Missing employeeName or inDate' });
        continue;
      }

      const employee = employeeMap.get(employeeName.toLowerCase().trim());
      if (!employee) {
        results.push({ employeeName, status: 'error', message: `Employee not found: "${employeeName}"` });
        continue;
      }

      try {
        const dayStart = moment.tz(`${inDate} 00:00:00`, 'YYYY-MM-DD HH:mm:ss', 'Asia/Kolkata').utc().toDate();
        const dayEnd = moment.tz(`${inDate} 23:59:59`, 'YYYY-MM-DD HH:mm:ss', 'Asia/Kolkata').utc().toDate();

        const [existingAttendance] = await Promise.all([
          prisma.attendance.findFirst({
            where: { employeeId: employee.id, date: { gte: dayStart, lte: dayEnd } },
            include: { sessions: true }
          })
        ]);

        // Case 1: Absent / On Leave
        if ((!inTime || customRemark === 'Absent' || customRemark === 'On Leave') && !outTime) {
          const targetRemark = customRemark || 'Absent';
          if (!existingAttendance) {
            await prisma.attendance.create({
              data: {
                employeeId: employee.id,
                employeeName: employee.employeeName,
                organizationCode: employee.organizationCode,
                date: dayStart,
                finalRemark: targetRemark,
                totalHours: 0,
                extraHours: 0
              }
            });
          } else {
            await prisma.$transaction([
              prisma.session.deleteMany({ where: { attendanceId: existingAttendance.id } }),
              prisma.attendance.update({
                where: { id: existingAttendance.id },
                data: { finalRemark: targetRemark, totalHours: 0, extraHours: 0 }
              })
            ]);
          }
          results.push({ employeeName, status: 'success', finalRemark: targetRemark });
          continue;
        }

        if (!inTime) {
          results.push({ employeeName, status: 'error', message: 'inTime is required when not marking Absent/On Leave' });
          continue;
        }

        // Determine Expected Times
        const expectedInTimeStr = employee.shift ? employee.shift.startTime : (organization.inTime || '09:00');
        const expectedOutTimeStr = employee.shift ? employee.shift.endTime : (organization.outTime || '18:00');
        const orgInFormat = employee.shift ? 'HH:mm' : 'hh:mm A';
        const orgOutFormat = employee.shift ? 'HH:mm' : 'hh:mm A';

        const organizationInTime = moment.tz(`${inDate} ${expectedInTimeStr}`, `YYYY-MM-DD ${orgInFormat}`, 'Asia/Kolkata').utc().toDate();
        let organizationOutTimeMom = moment.tz(`${inDate} ${expectedOutTimeStr}`, `YYYY-MM-DD ${orgOutFormat}`, 'Asia/Kolkata');
        let organizationInTimeMom = moment.tz(`${inDate} ${expectedInTimeStr}`, `YYYY-MM-DD ${orgInFormat}`, 'Asia/Kolkata');
        if (organizationOutTimeMom.isBefore(organizationInTimeMom)) organizationOutTimeMom.add(1, 'day');
        const organizationOutTime = organizationOutTimeMom.utc().toDate();

        const timeFormat = inTime.includes('AM') || inTime.includes('PM') ? 'hh:mm A' : 'HH:mm';
        const clockInActionTime = moment.tz(`${inDate} ${inTime}`, `YYYY-MM-DD ${timeFormat}`, 'Asia/Kolkata').utc().toDate();

        let clockInRemark = 'Present';
        if (moment(clockInActionTime).isSame(moment(organizationInTime), 'minute')) clockInRemark = 'On Time';
        else if (moment(clockInActionTime).isAfter(moment(organizationInTime))) clockInRemark = 'Late';
        else if (moment(clockInActionTime).isBefore(moment(organizationInTime))) clockInRemark = 'Early Login';

        let clockOutActionTime = null, clockOutRemark = null, duration = 0, totalHours = 0, extraHours = 0;
        let calculatedFinalRemark = 'Clocked In';

        if (outTime) {
          const effectiveOutDate = outDate || inDate;
          const outTimeFormat = outTime.includes('AM') || outTime.includes('PM') ? 'hh:mm A' : 'HH:mm';
          clockOutActionTime = moment.tz(`${effectiveOutDate} ${outTime}`, `YYYY-MM-DD ${outTimeFormat}`, 'Asia/Kolkata').utc().toDate();
          const durationMs = clockOutActionTime - clockInActionTime;
          duration = Math.max(0.01, parseFloat((durationMs / (1000 * 60 * 60)).toFixed(2)));
          totalHours = duration;

          clockOutRemark = 'Present';
          if (moment(clockOutActionTime).isSame(moment(organizationOutTime), 'minute')) clockOutRemark = 'On Time';
          else if (moment(clockOutActionTime).isBefore(moment(organizationOutTime))) clockOutRemark = 'Left Early';

          const expectedHours = moment(organizationOutTime).diff(moment(organizationInTime)) / (1000 * 60 * 60);
          if (expectedHours > 0 && totalHours > expectedHours) extraHours = parseFloat((totalHours - expectedHours).toFixed(2));

          const halfShiftHours = expectedHours > 0 ? expectedHours / 2 : 4;
          const isLate = clockInRemark === 'Late';
          const isEarlyLogout = clockOutRemark === 'Left Early';
          if (totalHours < halfShiftHours) calculatedFinalRemark = 'Half Day';
          else if (isLate && isEarlyLogout) calculatedFinalRemark = 'Late & Left Early';
          else if (isLate) calculatedFinalRemark = 'Late';
          else if (isEarlyLogout) calculatedFinalRemark = 'Left Early';
          else if (clockInRemark === 'Early Login') calculatedFinalRemark = 'Early Login';
          else calculatedFinalRemark = 'On Time';
        }

        const finalRemarkToSave = (customRemark && customRemark !== 'Auto')
          ? customRemark
          : (outTime ? calculatedFinalRemark : 'Clocked In');

        if (!existingAttendance) {
          await prisma.attendance.create({
            data: {
              employeeId: employee.id,
              employeeName: employee.employeeName,
              organizationCode: employee.organizationCode,
              date: clockInActionTime,
              finalRemark: finalRemarkToSave,
              totalHours, extraHours,
              sessions: {
                create: {
                  clockInTime: clockInActionTime, clockInRemark,
                  clockOutTime: clockOutActionTime, clockOutRemark, duration
                }
              }
            }
          });
        } else {
          const targetSession = existingAttendance.sessions?.[0] || null;
          await prisma.attendance.update({
            where: { id: existingAttendance.id },
            data: {
              totalHours, extraHours, finalRemark: finalRemarkToSave,
              sessions: targetSession ? {
                update: {
                  where: { id: targetSession.id },
                  data: { clockInTime: clockInActionTime, clockInRemark, clockOutTime: clockOutActionTime, clockOutRemark, duration }
                }
              } : {
                create: { clockInTime: clockInActionTime, clockInRemark, clockOutTime: clockOutActionTime, clockOutRemark, duration }
              }
            }
          });
        }

        results.push({ employeeName, status: 'success', finalRemark: finalRemarkToSave, totalHours });
      } catch (rowError) {
        results.push({ employeeName, status: 'error', message: rowError.message });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    res.status(200).send({
      message: `Bulk upload complete: ${successCount} succeeded, ${errorCount} failed.`,
      successCount,
      errorCount,
      results
    });
  } catch (error) {
    console.error('Error in bulk attendance upload:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

router.get('/employees/:employeeId/attendance-by-date', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
  // #swagger.tags = ['All Company']
  try {
    const { employeeId } = req.params;
    const { date } = req.query;
    const organizationId = req.organizationId;

    if (!date) {
      return res.status(400).send({ message: 'Date query parameter is required (YYYY-MM-DD).' });
    }

    const organization = req.targetOrganization || await prisma.organization.findUnique({
      where: { id: organizationId }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const dayStart = moment.tz(`${date} 00:00:00`, 'YYYY-MM-DD HH:mm:ss', 'Asia/Kolkata').utc().toDate();
    const dayEnd = moment.tz(`${date} 23:59:59`, 'YYYY-MM-DD HH:mm:ss', 'Asia/Kolkata').utc().toDate();

    const [employee, attendanceRecord] = await Promise.all([
      prisma.employee.findUnique({
        where: { id: employeeId },
        include: { shift: true }
      }),
      prisma.attendance.findFirst({
        where: {
          employeeId,
          date: { gte: dayStart, lte: dayEnd }
        },
        include: {
          sessions: {
            orderBy: { clockInTime: 'asc' }
          }
        }
      })
    ]);

    if (!employee || (employee.organizationCode !== organization.organizationCode)) {
      return res.status(404).send({ message: 'Employee not found' });
    }

    res.status(200).send({
      attendance: attendanceRecord,
      shift: employee.shift || null,
      organizationTimes: {
        inTime: organization.inTime,
        outTime: organization.outTime
      }
    });
  } catch (error) {
    console.error('Error fetching employee attendance by date:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

router.post('/employees/:employeeId/manual-attendance', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
    // #swagger.tags = ['All Company']
  try {
    const { employeeId } = req.params;
    const { inDate, inTime, outDate, outTime, finalRemark: customRemark } = req.body;
    const organizationId = req.organizationId;

    if (!inDate) {
      return res.status(400).send({ message: 'Missing required field: inDate' });
    }

    const organization = req.targetOrganization || await prisma.organization.findUnique({
      where: { id: organizationId }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const dayStart = moment.tz(`${inDate} 00:00:00`, 'YYYY-MM-DD HH:mm:ss', 'Asia/Kolkata').utc().toDate();
    const dayEnd = moment.tz(`${inDate} 23:59:59`, 'YYYY-MM-DD HH:mm:ss', 'Asia/Kolkata').utc().toDate();

    // Fetch employee and attendance concurrently in 1 DB round trip
    const [employee, attendanceRecord] = await Promise.all([
      prisma.employee.findUnique({
        where: { id: employeeId },
        include: { shift: true }
      }),
      prisma.attendance.findFirst({
        where: {
          employeeId,
          date: { gte: dayStart, lte: dayEnd }
        },
        include: { sessions: true }
      })
    ]);

    if (!employee || (employee.organizationCode !== organization.organizationCode)) {
      return res.status(404).send({ message: 'Employee not found' });
    }

    // Case 1: Marking as Absent or On Leave (no inTime or remark is Absent/On Leave)
    if ((!inTime || customRemark === 'Absent' || customRemark === 'On Leave') && !outTime) {
      const targetRemark = customRemark || 'Absent';
      if (!attendanceRecord) {
        const created = await prisma.attendance.create({
          data: {
            employeeId: employee.id,
            employeeName: employee.employeeName,
            organizationCode: employee.organizationCode,
            date: dayStart,
            finalRemark: targetRemark,
            totalHours: 0,
            extraHours: 0
          },
          include: { sessions: true }
        });
        return res.status(200).send({
          message: `Attendance marked as ${targetRemark} successfully.`,
          attendance: created
        });
      } else {
        const [_, updated] = await prisma.$transaction([
          prisma.session.deleteMany({
            where: { attendanceId: attendanceRecord.id }
          }),
          prisma.attendance.update({
            where: { id: attendanceRecord.id },
            data: {
              finalRemark: targetRemark,
              totalHours: 0,
              extraHours: 0
            },
            include: { sessions: true }
          })
        ]);
        return res.status(200).send({
          message: `Attendance marked as ${targetRemark} successfully.`,
          attendance: updated
        });
      }
    }

    if (!inTime) {
      return res.status(400).send({ message: 'In time is required when clocking in.' });
    }

    // Determine Expected Times (pure in-memory logic)
    const expectedInTimeStr = employee.shift ? employee.shift.startTime : (organization.inTime || '09:00');
    const expectedOutTimeStr = employee.shift ? employee.shift.endTime : (organization.outTime || '18:00');
    const orgInFormat = employee.shift ? 'HH:mm' : 'hh:mm A';
    const orgOutFormat = employee.shift ? 'HH:mm' : 'hh:mm A';

    const organizationInTime = moment.tz(`${inDate} ${expectedInTimeStr}`, `YYYY-MM-DD ${orgInFormat}`, 'Asia/Kolkata').utc().toDate();
    let organizationOutTimeMom = moment.tz(`${inDate} ${expectedOutTimeStr}`, `YYYY-MM-DD ${orgOutFormat}`, 'Asia/Kolkata');
    let organizationInTimeMom = moment.tz(`${inDate} ${expectedInTimeStr}`, `YYYY-MM-DD ${orgInFormat}`, 'Asia/Kolkata');
    if (organizationOutTimeMom.isBefore(organizationInTimeMom)) {
      organizationOutTimeMom.add(1, 'day');
    }
    const organizationOutTime = organizationOutTimeMom.utc().toDate();

    // Parse the actual clock-in action time
    const timeFormat = inTime.includes('AM') || inTime.includes('PM') ? 'hh:mm A' : 'HH:mm';
    const clockInActionTime = moment.tz(`${inDate} ${inTime}`, `YYYY-MM-DD ${timeFormat}`, 'Asia/Kolkata').utc().toDate();

    let clockInRemark = 'Present';
    if (moment(clockInActionTime).isSame(moment(organizationInTime), 'minute')) {
      clockInRemark = 'On Time';
    } else if (moment(clockInActionTime).isAfter(moment(organizationInTime))) {
      clockInRemark = 'Late';
    } else if (moment(clockInActionTime).isBefore(moment(organizationInTime))) {
      clockInRemark = 'Early Login';
    }

    // Handle Clock Out if outTime is present
    let clockOutActionTime = null;
    let clockOutRemark = null;
    let duration = 0;
    let totalHours = 0;
    let extraHours = 0;
    let calculatedFinalRemark = 'Clocked In';

    if (outTime) {
      const effectiveOutDate = outDate || inDate;
      const outTimeFormat = outTime.includes('AM') || outTime.includes('PM') ? 'hh:mm A' : 'HH:mm';
      clockOutActionTime = moment.tz(`${effectiveOutDate} ${outTime}`, `YYYY-MM-DD ${outTimeFormat}`, 'Asia/Kolkata').utc().toDate();

      const durationMs = clockOutActionTime - clockInActionTime;
      duration = Math.max(0.01, parseFloat((durationMs / (1000 * 60 * 60)).toFixed(2)));
      totalHours = duration;

      clockOutRemark = 'Present';
      if (moment(clockOutActionTime).isSame(moment(organizationOutTime), 'minute')) {
        clockOutRemark = 'On Time';
      } else if (moment(clockOutActionTime).isBefore(moment(organizationOutTime))) {
        clockOutRemark = 'Left Early';
      }

      const expectedDurationMs = moment(organizationOutTime).diff(moment(organizationInTime));
      const expectedHours = expectedDurationMs > 0 ? expectedDurationMs / (1000 * 60 * 60) : 0;
      if (expectedHours > 0 && totalHours > expectedHours) {
        extraHours = parseFloat((totalHours - expectedHours).toFixed(2));
      }

      const halfShiftHours = expectedHours > 0 ? (expectedHours / 2) : 4;
      const isLate = clockInRemark === 'Late';
      const isEarlyLogout = clockOutRemark === 'Left Early';

      if (totalHours < halfShiftHours) {
        calculatedFinalRemark = 'Half Day';
      } else if (isLate && isEarlyLogout) {
        calculatedFinalRemark = 'Late & Left Early';
      } else if (isLate) {
        calculatedFinalRemark = 'Late';
      } else if (isEarlyLogout) {
        calculatedFinalRemark = 'Left Early';
      } else if (clockInRemark === 'Early Login') {
        calculatedFinalRemark = 'Early Login';
      } else {
        calculatedFinalRemark = 'On Time';
      }
    }

    const finalRemarkToSave = (customRemark && customRemark !== 'Auto')
      ? customRemark
      : (outTime ? calculatedFinalRemark : 'Clocked In');

    let resultAttendance;

    if (!attendanceRecord) {
      // Create Attendance + Session in 1 DB operation!
      resultAttendance = await prisma.attendance.create({
        data: {
          employeeId: employee.id,
          employeeName: employee.employeeName,
          organizationCode: employee.organizationCode,
          date: clockInActionTime,
          finalRemark: finalRemarkToSave,
          totalHours,
          extraHours,
          sessions: {
            create: {
              clockInTime: clockInActionTime,
              clockInRemark,
              clockOutTime: clockOutActionTime,
              clockOutRemark,
              duration
            }
          }
        },
        include: { sessions: true }
      });
    } else {
      // Update Attendance + Session in 1 DB operation!
      const targetSession = attendanceRecord.sessions && attendanceRecord.sessions.length > 0 ? attendanceRecord.sessions[0] : null;

      resultAttendance = await prisma.attendance.update({
        where: { id: attendanceRecord.id },
        data: {
          totalHours,
          extraHours,
          finalRemark: finalRemarkToSave,
          sessions: targetSession ? {
            update: {
              where: { id: targetSession.id },
              data: {
                clockInTime: clockInActionTime,
                clockInRemark,
                clockOutTime: clockOutActionTime,
                clockOutRemark,
                duration
              }
            }
          } : {
            create: {
              clockInTime: clockInActionTime,
              clockInRemark,
              clockOutTime: clockOutActionTime,
              clockOutRemark,
              duration
            }
          }
        },
        include: { sessions: true }
      });
    }

    return res.status(200).send({
      message: outTime ? 'Attendance recorded and updated successfully.' : 'Attendance clocked in / updated successfully.',
      totalHours,
      extraHours,
      finalRemark: finalRemarkToSave,
      attendance: resultAttendance
    });
  } catch (error) {
    console.error('Error in manual attendance:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Organization Expense Management ==================

// ================== Employee Finance Summary ==================

/**
 * @swagger
 * /api/organization/employees/{employeeId}/finance-summary:
 *   get:
 *     summary: Get finance summary for a specific employee (salary, working days, pending expenses)
 *     tags: [All Company]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: month
 *         schema:
 *           type: string
 *           example: "2024-09"
 *         description: Month in YYYY-MM format. Defaults to current month.
 *     responses:
 *       200:
 *         description: Finance summary including working days, salary, and expenses
 *       404:
 *         description: Employee not found
 */
router.get('/employees/:employeeId/finance-summary', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
  // #swagger.tags = ['All Company']
  try {
    const { employeeId } = req.params;
    const { month } = req.query;

    // Parse month (default = current month)
    const targetMonth = month ? moment(month, 'YYYY-MM') : moment().tz('Asia/Kolkata');
    if (!targetMonth.isValid()) {
      return res.status(400).json({ message: 'Invalid month format. Use YYYY-MM.' });
    }

    const monthStart = targetMonth.clone().startOf('month').toDate();
    const monthEnd   = targetMonth.clone().endOf('month').toDate();

    // 1. Load employee with shift & org
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId: req.organizationId },
      select: {
        id: true,
        employeeName: true,
        employeeEmail: true,
        profilePic: true,
        salary: true,
        shift: { select: { name: true, weekOffs: true } },
        organization: { select: { holidays: { where: { startDate: { lte: monthEnd }, endDate: { gte: monthStart } }, select: { name: true, startDate: true, endDate: true } } } }
      }
    });

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found in this organization.' });
    }

    // 2. Calculate calendar days in month
    const daysInMonth = targetMonth.daysInMonth();
    const weekOffNames = employee.shift?.weekOffs
      ? employee.shift.weekOffs.split(',').map(d => d.trim().toLowerCase())
      : [];

    // 3. Expand holidays into individual dates (Set for O(1) lookup)
    const holidayDates = new Set();
    for (const h of (employee.organization?.holidays || [])) {
      let d = moment(h.startDate);
      const end = moment(h.endDate);
      while (d.isSameOrBefore(end, 'day')) {
        holidayDates.add(d.format('YYYY-MM-DD'));
        d.add(1, 'day');
      }
    }

    // 4. Walk every day of the month → count expected working days & week-offs
    let expectedWorkingDays = 0;
    let weekOffCount = 0;
    let holidayCount = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const d = targetMonth.clone().date(day);
      const dateStr = d.format('YYYY-MM-DD');
      const dayName = d.format('dddd').toLowerCase();

      if (weekOffNames.includes(dayName)) {
        weekOffCount++;
      } else if (holidayDates.has(dateStr)) {
        holidayCount++;
      } else {
        expectedWorkingDays++;
      }
    }

    // 5–7. Fetch attendance + both expense aggregates in parallel
    const PRESENT_REMARKS = ['Present', 'Half Day', 'Left Early', 'Clocked In', 'Regularized'];
    const [attendances, approvedExpenses, pendingExpenses] = await Promise.all([
      prisma.attendance.findMany({
        where: {
          employeeId,
          date: { gte: monthStart, lte: monthEnd },
          finalRemark: { in: PRESENT_REMARKS }
        },
        select: { date: true, finalRemark: true, totalHours: true }
      }),
      // 7. Approved-but-unpaid expenses (reimbursable)
      prisma.expense.aggregate({
        where: { employeeId, organizationId: req.organizationId, status: 'APPROVED' },
        _sum: { amount: true },
        _count: { id: true }
      }),
      // 8. Pending expenses (submitted, waiting review)
      prisma.expense.aggregate({
        where: { employeeId, organizationId: req.organizationId, status: 'PENDING' },
        _sum: { amount: true },
        _count: { id: true }
      })
    ]);


    // Count actual working days (Half Day = 0.5)
    let actualWorkingDays = 0;
    for (const a of attendances) {
      if (a.finalRemark === 'Half Day') {
        actualWorkingDays += 0.5;
      } else {
        actualWorkingDays += 1;
      }
    }

    // 6. Salary calculation
    const monthlySalary = employee.salary || 0;
    const perDaySalary  = expectedWorkingDays > 0 ? monthlySalary / expectedWorkingDays : 0;
    const earnedSalary  = parseFloat((perDaySalary * actualWorkingDays).toFixed(2));
    const deduction     = parseFloat((monthlySalary - earnedSalary).toFixed(2));
    const absentDays    = parseFloat((expectedWorkingDays - actualWorkingDays).toFixed(1));

    const approvedUnpaidAmount = approvedExpenses._sum.amount || 0;
    const approvedUnpaidCount  = approvedExpenses._count.id || 0;

    // 9. Net payable = earned salary + approved reimbursements
    const netPayable = parseFloat((earnedSalary + approvedUnpaidAmount).toFixed(2));


    return res.status(200).json({
      employee: {
        id: employee.id,
        employeeName: employee.employeeName,
        employeeEmail: employee.employeeEmail,
        profilePic: employee.profilePic,
        monthlySalary,
        shift: employee.shift?.name || null
      },
      month: targetMonth.format('YYYY-MM'),
      workingDays: {
        daysInMonth,
        expected: expectedWorkingDays,
        actual: actualWorkingDays,
        absent: absentDays,
        weekOffs: weekOffCount,
        holidays: holidayCount
      },
      salary: {
        monthly: monthlySalary,
        perDay: parseFloat(perDaySalary.toFixed(2)),
        earned: earnedSalary,
        deduction
      },
      expenses: {
        approvedUnpaid: {
          count: approvedUnpaidCount,
          amount: approvedUnpaidAmount
        },
        pending: {
          count: pendingExpenses._count.id || 0,
          amount: pendingExpenses._sum.amount || 0
        }
      },
      netPayable
    });
  } catch (error) {
    console.error('Error fetching employee finance summary:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @swagger
 * /api/organization/employees/{employeeId}/expenses:
 *   get:
 *     summary: Get all expense claims of a specific employee (Admin)
 *     tags: [All Company]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the employee
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ALL, PENDING, APPROVED, REJECTED, PAID]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of expense claims for the employee
 *       403:
 *         description: Employee does not belong to this organization
 *       404:
 *         description: Employee not found
 */
router.get('/employees/:employeeId/expenses', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
  // #swagger.tags = ['All Company']
  try {
    const { employeeId } = req.params;
    const { status, page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Verify the employee belongs to this organization
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId: req.organizationId },
      select: { id: true, employeeName: true, employeeEmail: true, profilePic: true, salary: true }
    });

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found in this organization.' });
    }

    const where = { employeeId, organizationId: req.organizationId };

    if (status && status !== 'ALL') {
      const validStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'PAID'];
      if (!validStatuses.includes(status.toUpperCase())) {
        return res.status(400).json({ message: 'Invalid status filter.' });
      }
      where.status = status.toUpperCase();
    }

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        select: {
          id: true,
          title: true,
          type: true,
          amount: true,
          billUrl: true,
          description: true,
          status: true,
          rejectionReason: true,
          reviewedBy: true,
          reviewedAt: true,
          createdAt: true,
          updatedAt: true,
        }
      }),
      prisma.expense.count({ where: { employeeId, organizationId: req.organizationId } })
    ]);

    // Summary stats for this employee's expenses
    const allExpenses = await prisma.expense.groupBy({
      by: ['status'],
      where: { employeeId, organizationId: req.organizationId },
      _count: { status: true },
      _sum: { amount: true }
    });

    const stats = { PENDING: { count: 0, total: 0 }, APPROVED: { count: 0, total: 0 }, REJECTED: { count: 0, total: 0 }, PAID: { count: 0, total: 0 } };
    allExpenses.forEach(s => {
      stats[s.status] = { count: s._count.status, total: s._sum.amount || 0 };
    });

    return res.status(200).json({
      employee,
      expenses,
      stats,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching employee expenses:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @swagger
 * /api/organization/expenses:
 *   get:
 *     summary: Get all employee expense claims for the organization
 *     tags: [All Company]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED, PAID]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by employee name or expense title/type
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of expense claims
 */
router.get('/expenses', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
  // #swagger.tags = ['All Company']
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const where = { organizationId: req.organizationId };

    if (status && status !== 'ALL') {
      const validStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'PAID'];
      if (!validStatuses.includes(status.toUpperCase())) {
        return res.status(400).json({ message: 'Invalid status filter.' });
      }
      where.status = status.toUpperCase();
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { title: { contains: q } },
        { type: { contains: q } },
        { employee: { employeeName: { contains: q } } },
      ];
    }

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        select: {
          id: true,
          title: true,
          type: true,
          amount: true,
          billUrl: true,
          description: true,
          status: true,
          rejectionReason: true,
          reviewedBy: true,
          reviewedAt: true,
          createdAt: true,
          updatedAt: true,
          employee: {
            select: {
              id: true,
              employeeName: true,
              employeeEmail: true,
              profilePic: true,
            }
          }
        }
      }),
      prisma.expense.count({ where })
    ]);

    const stats = await prisma.expense.groupBy({
      by: ['status'],
      where: { organizationId: req.organizationId },
      _count: { status: true },
      _sum: { amount: true }
    });

    const statsMap = {
      PENDING: 0,
      APPROVED: 0,
      REJECTED: 0,
      PAID: 0,
      approvedAmount: 0,
      paidAmount: 0,
      pendingAmount: 0,
      rejectedAmount: 0,
      totalAmount: 0
    };

    stats.forEach(s => {
      statsMap[s.status] = s._count.status;
      if (s.status === 'APPROVED') statsMap.approvedAmount = s._sum.amount || 0;
      if (s.status === 'PAID') statsMap.paidAmount = s._sum.amount || 0;
      if (s.status === 'PENDING') statsMap.pendingAmount = s._sum.amount || 0;
      if (s.status === 'REJECTED') statsMap.rejectedAmount = s._sum.amount || 0;
    });

    // Total expense amount for stats: ONLY include Approved and Paid claims (exclude Rejected and Pending)
    statsMap.totalAmount = (statsMap.approvedAmount || 0) + (statsMap.paidAmount || 0);

    return res.status(200).json({
      expenses,
      stats: statsMap,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching organization expenses:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @swagger
 * /api/organization/expenses/{id}/status:
 *   patch:
 *     summary: Update the status of an expense claim (Approve / Reject / Mark Paid)
 *     tags: [All Company]
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
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [APPROVED, REJECTED, PAID]
 *               rejectionReason:
 *                 type: string
 *                 description: Required when status is REJECTED
 *     responses:
 *       200:
 *         description: Expense status updated
 *       400:
 *         description: Invalid status or missing rejection reason
 *       404:
 *         description: Expense not found
 */
router.patch('/expenses/:id/status', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
  // #swagger.tags = ['All Company']
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    const validStatuses = ['APPROVED', 'REJECTED', 'PAID'];
    if (!status || !validStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({ message: `status must be one of: ${validStatuses.join(', ')}` });
    }

    if (status.toUpperCase() === 'REJECTED' && !rejectionReason?.trim()) {
      return res.status(400).json({ message: 'rejectionReason is required when rejecting an expense.' });
    }

    const expense = await prisma.expense.findFirst({
      where: { id, organizationId: req.organizationId }
    });

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found in this organization.' });
    }

    const updated = await prisma.expense.update({
      where: { id },
      data: {
        status: status.toUpperCase(),
        rejectionReason: status.toUpperCase() === 'REJECTED' ? rejectionReason.trim() : null,
        reviewedBy: req.admin?.email || req.user?.email || 'Admin',
        reviewedAt: new Date(),
      }
    });

    return res.status(200).json({ message: `Expense ${status.toLowerCase()} successfully.`, expense: updated });
  } catch (error) {
    console.error('Error updating expense status:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;


