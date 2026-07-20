const request = require('supertest');
const app = require('../app');
const Organization = require('../models/organization');
const Schedule = require('../models/schedule');

describe('Schedule Endpoints', () => {
    let orgToken;
    let orgId;

    beforeEach(async () => {
        // Mock mail sender
        jest.mock('../Handlers/sendEmail', () => jest.fn().mockResolvedValue(true));

        const testOrg = {
            organizationName: 'Schedule Test Org',
            organizationEmail: 'schedule@org.com',
            organizationOwnerName: 'Owner Name',
            password: 'password123',
            confirmPassword: 'password123'
        };

        // Create Org
        await request(app).post('/api/organization/signup').send(testOrg);
        const org = await Organization.findOne({ organizationEmail: testOrg.organizationEmail });
        
        // Verify Org
        await request(app).post('/api/organization/verify-otp').send({ email: testOrg.organizationEmail, otp: org.otp, action: 'verify-email' });

        // Login
        const loginRes = await request(app).post('/api/organization/login').send({
            email: testOrg.organizationEmail,
            password: testOrg.password
        });
        
        orgToken = loginRes.body.token;
        orgId = org._id;
    });

    describe('POST /api/organization/schedule', () => {
        it('should create a new schedule', async () => {
            const res = await request(app)
                .post('/api/organization/schedule')
                .set('Authorization', `Bearer ${orgToken}`)
                .send({
                    name: 'Morning Shift',
                    inTime: '09:00 AM',
                    outTime: '05:00 PM',
                    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
                });

            expect(res.status).toBe(201);
            expect(res.body.message).toBe('Schedule created successfully');
            expect(res.body.schedule.name).toBe('Morning Shift');
        });

        it('should return 400 if required fields are missing', async () => {
            const res = await request(app)
                .post('/api/organization/schedule')
                .set('Authorization', `Bearer ${orgToken}`)
                .send({
                    name: 'Night Shift'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Name, inTime, and outTime are required');
        });
    });

    describe('Operations on existing schedule', () => {
        let scheduleId;

        beforeEach(async () => {
            const res = await request(app)
                .post('/api/organization/schedule')
                .set('Authorization', `Bearer ${orgToken}`)
                .send({
                    name: 'Morning Shift',
                    inTime: '09:00 AM',
                    outTime: '05:00 PM',
                    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
                });
            scheduleId = res.body.schedule._id;
        });

        it('should get all schedules for the organization', async () => {
            const res = await request(app)
                .get('/api/organization/schedule')
                .set('Authorization', `Bearer ${orgToken}`);

            expect(res.status).toBe(200);
            expect(res.body.schedules.length).toBeGreaterThan(0);
            expect(res.body.schedules[0].name).toBe('Morning Shift');
        });

        it('should update the schedule', async () => {
            const res = await request(app)
                .put(`/api/organization/schedule/${scheduleId}`)
                .set('Authorization', `Bearer ${orgToken}`)
                .send({
                    inTime: '10:00 AM'
                });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Schedule updated successfully');
            expect(res.body.schedule.inTime).toBe('10:00 AM');
        });

        it('should delete the schedule', async () => {
            const res = await request(app)
                .delete(`/api/organization/schedule/${scheduleId}`)
                .set('Authorization', `Bearer ${orgToken}`);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Schedule deleted successfully');

            const check = await Schedule.findById(scheduleId);
            expect(check).toBeNull();
        });
    });
});
