const Schedule = require('../models/schedule');
const Employee = require('../models/employee');
const Organization = require('../models/organization');

exports.createSchedule = async (req, res) => {
    try {
        const organizationId = req.user.id;
        const organization = await Organization.findById(organizationId);
        
        if (!organization) {
            return res.status(404).json({ message: 'Organization not found' });
        }

        const { name, inTime, outTime, workingDays } = req.body;

        if (!name || !inTime || !outTime) {
            return res.status(400).json({ message: 'Name, inTime, and outTime are required' });
        }

        const schedule = new Schedule({
            organization: organizationId,
            organizationCode: organization.organizationCode,
            name,
            inTime,
            outTime,
            workingDays: workingDays || organization.workingDays
        });

        await schedule.save();
        res.status(201).json({ message: 'Schedule created successfully', schedule });
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getSchedules = async (req, res) => {
    try {
        const organizationId = req.user.id;
        
        const schedules = await Schedule.find({ organization: organizationId });
        res.status(200).json({ schedules });
    } catch (error) {
        console.error('Error fetching schedules:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.updateSchedule = async (req, res) => {
    try {
        const { scheduleId } = req.params;
        const organizationId = req.user.id;

        const updatedSchedule = await Schedule.findOneAndUpdate(
            { _id: scheduleId, organization: organizationId },
            { $set: req.body },
            { new: true, runValidators: true }
        );

        if (!updatedSchedule) {
            return res.status(404).json({ message: 'Schedule not found or unauthorized' });
        }

        res.status(200).json({ message: 'Schedule updated successfully', schedule: updatedSchedule });
    } catch (error) {
        console.error('Error updating schedule:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.deleteSchedule = async (req, res) => {
    try {
        const { scheduleId } = req.params;
        const organizationId = req.user.id;

        const schedule = await Schedule.findOneAndDelete({ _id: scheduleId, organization: organizationId });

        if (!schedule) {
            return res.status(404).json({ message: 'Schedule not found or unauthorized' });
        }

        // Also remove this schedule from any employees assigned to it
        await Employee.updateMany(
            { schedule: scheduleId },
            { $unset: { schedule: 1 } }
        );

        res.status(200).json({ message: 'Schedule deleted successfully' });
    } catch (error) {
        console.error('Error deleting schedule:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.assignScheduleToEmployee = async (req, res) => {
    try {
        const { employeeId, scheduleId } = req.body;
        const organizationId = req.user.id;
        const organization = await Organization.findById(organizationId);

        if (!organization) {
            return res.status(404).json({ message: 'Organization not found' });
        }

        const employee = await Employee.findOne({ _id: employeeId, organizationCode: organization.organizationCode });
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found in this organization' });
        }

        if (scheduleId) {
            const schedule = await Schedule.findOne({ _id: scheduleId, organization: organizationId });
            if (!schedule) {
                return res.status(404).json({ message: 'Schedule not found' });
            }
            employee.schedule = scheduleId;
        } else {
            // Unassign schedule
            employee.schedule = undefined;
        }

        await employee.save();

        res.status(200).json({ message: 'Schedule assigned successfully', employee });
    } catch (error) {
        console.error('Error assigning schedule:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
