const express = require('express');
const authenticateJWT = require('../middleware/authenticateJWT');
const prisma = require('../prisma/client');

const router = express.Router();

// ================== Create a Shift ==================
router.post('/', authenticateJWT, async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user.id }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const { name, startTime, endTime, weekOffs } = req.body;
    if (!name || !startTime || !endTime) {
      return res.status(400).send({ message: 'Name, startTime, and endTime are required' });
    }

    const shift = await prisma.shift.create({
      data: {
        organizationId: organization.id,
        name,
        startTime,
        endTime,
        weekOffs: weekOffs ? weekOffs.join(',') : null
      }
    });

    res.status(201).send({ message: 'Shift created successfully', shift });
  } catch (error) {
    console.error('Error creating shift:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Get all Shifts for Organization ==================
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user.id }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const shifts = await prisma.shift.findMany({
      where: { organizationId: organization.id },
      orderBy: { createdAt: 'desc' }
    });

    // Parse weekOffs back to array
    const parsedShifts = shifts.map(shift => ({
      ...shift,
      weekOffs: shift.weekOffs ? shift.weekOffs.split(',') : []
    }));

    res.status(200).send({ shifts: parsedShifts });
  } catch (error) {
    console.error('Error getting shifts:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Update a Shift ==================
router.put('/:id', authenticateJWT, async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user.id }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const { name, startTime, endTime, weekOffs } = req.body;
    
    const existingShift = await prisma.shift.findFirst({
      where: {
        id: req.params.id,
        organizationId: organization.id
      }
    });

    if (!existingShift) return res.status(404).send({ message: 'Shift not found' });

    const updatedShift = await prisma.shift.update({
      where: { id: req.params.id },
      data: {
        name: name || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        weekOffs: weekOffs ? weekOffs.join(',') : existingShift.weekOffs
      }
    });

    res.status(200).send({ message: 'Shift updated successfully', shift: updatedShift });
  } catch (error) {
    console.error('Error updating shift:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Delete a Shift ==================
router.delete('/:id', authenticateJWT, async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user.id }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const existingShift = await prisma.shift.findFirst({
      where: {
        id: req.params.id,
        organizationId: organization.id
      }
    });

    if (!existingShift) return res.status(404).send({ message: 'Shift not found' });

    await prisma.shift.delete({
      where: { id: req.params.id }
    });

    res.status(200).send({ message: 'Shift deleted successfully' });
  } catch (error) {
    console.error('Error deleting shift:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Assign Shift to Employee ==================
router.post('/assign-to-employee/:employeeId', authenticateJWT, async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user.id }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const { shiftId } = req.body;

    const employee = await prisma.employee.findFirst({
      where: {
        id: req.params.employeeId,
        organizationCode: organization.organizationCode
      }
    });

    if (!employee) return res.status(404).send({ message: 'Employee not found' });

    // if shiftId is null, it removes the shift
    if (shiftId) {
      const shift = await prisma.shift.findFirst({
        where: { id: shiftId, organizationId: organization.id }
      });
      if (!shift) return res.status(404).send({ message: 'Shift not found' });
    }

    const updatedEmployee = await prisma.employee.update({
      where: { id: req.params.employeeId },
      data: { shiftId: shiftId || null }
    });

    res.status(200).send({ message: 'Shift assigned successfully', employee: updatedEmployee });
  } catch (error) {
    console.error('Error assigning shift:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
