const { PrismaClient } = require('@prisma/client');
const moment = require('moment-timezone');

const prisma = new PrismaClient();

const requireAttendance = async (req, res, next) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const employeeId = req.user.id;
        
        // Find employee shift to determine start and end times
        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            include: { organization: true, shift: true }
        });

        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        const currentDate = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
        const inTimeStr = employee.shift ? employee.shift.startTime : employee.organization.inTime;
        const outTimeStr = employee.shift ? employee.shift.endTime : employee.organization.outTime;
        
        const orgInFormat = employee.shift ? 'HH:mm' : 'hh:mm A';
        const orgOutFormat = employee.shift ? 'HH:mm' : 'hh:mm A';

        let shiftStart = moment.tz(`${currentDate} ${inTimeStr}`, `YYYY-MM-DD ${orgInFormat}`, 'Asia/Kolkata');
        let shiftEnd = moment.tz(`${currentDate} ${outTimeStr}`, `YYYY-MM-DD ${orgOutFormat}`, 'Asia/Kolkata');
        if (shiftEnd.isBefore(shiftStart)) shiftEnd.add(1, 'day');

        const attendance = await prisma.attendance.findFirst({
            where: {
                employeeId: employeeId,
                date: {
                    gte: shiftStart.startOf('day').toDate(),
                    lte: shiftEnd.endOf('day').toDate()
                }
            }
        });

        if (!attendance) {
            return res.status(403).json({ success: false, message: 'Please mark your attendance first.' });
        }
        
        next();
    } catch (error) {
        console.error('Require attendance middleware error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

module.exports = requireAttendance;
