const request = require('supertest');
const app = require('../app');
const Organization = require('../models/organization');

describe('Organization Auth Endpoints', () => {
    
    // We mock the mailer so we don't actually send emails during tests
    jest.mock('../Handlers/sendEmail', () => jest.fn().mockResolvedValue(true));

    const testOrg = {
        organizationName: 'Test Org',
        organizationEmail: 'test@org.com',
        organizationOwnerName: 'Owner Name',
        password: 'password123',
        confirmPassword: 'password123'
    };

    describe('POST /api/organization/signup', () => {
        it('should register a new organization and return 201', async () => {
            const response = await request(app)
                .post('/api/organization/signup')
                .send(testOrg);

            expect(response.status).toBe(201);
            expect(response.body.message).toBe('Organization created. Please verify your email.');

            const orgInDb = await Organization.findOne({ organizationEmail: testOrg.organizationEmail });
            expect(orgInDb).toBeTruthy();
            expect(orgInDb.organizationName).toBe(testOrg.organizationName);
            expect(orgInDb.isVerified).toBe(false);
            expect(orgInDb.otp).toBeDefined();
        });

        it('should return 400 if organization already exists', async () => {
            // First time signup
            await request(app).post('/api/organization/signup').send(testOrg);
            
            // Second time signup with same email
            const response = await request(app)
                .post('/api/organization/signup')
                .send(testOrg);

            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Organization already exists');
        });
    });

    describe('POST /api/organization/verify-otp', () => {
        it('should verify OTP successfully', async () => {
            // Create org
            await request(app).post('/api/organization/signup').send(testOrg);
            const org = await Organization.findOne({ organizationEmail: testOrg.organizationEmail });

            const response = await request(app)
                .post('/api/organization/verify-otp')
                .send({
                    email: testOrg.organizationEmail,
                    otp: org.otp,
                    action: 'verify-email'
                });

            expect(response.status).toBe(200);
            expect(response.body.message).toBe('Email verified successfully.');

            const verifiedOrg = await Organization.findOne({ organizationEmail: testOrg.organizationEmail });
            expect(verifiedOrg.isVerified).toBe(true);
            expect(verifiedOrg.otp).toBeUndefined();
        });

        it('should return 400 for invalid OTP', async () => {
            await request(app).post('/api/organization/signup').send(testOrg);

            const response = await request(app)
                .post('/api/organization/verify-otp')
                .send({
                    email: testOrg.organizationEmail,
                    otp: '000000', // Incorrect OTP
                    action: 'verify-email'
                });

            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Invalid or expired OTP.');
        });
    });

    describe('POST /api/organization/login', () => {
        beforeEach(async () => {
            // Create and verify org before each login test
            await request(app).post('/api/organization/signup').send(testOrg);
            const org = await Organization.findOne({ organizationEmail: testOrg.organizationEmail });
            await request(app).post('/api/organization/verify-otp').send({ email: testOrg.organizationEmail, otp: org.otp, action: 'verify-email' });
        });

        it('should login successfully with correct credentials', async () => {
            const response = await request(app)
                .post('/api/organization/login')
                .send({
                    email: testOrg.organizationEmail,
                    password: testOrg.password
                });

            expect(response.status).toBe(200);
            expect(response.body.token).toBeDefined();
        });

        it('should return 400 with incorrect password', async () => {
            const response = await request(app)
                .post('/api/organization/login')
                .send({
                    email: testOrg.organizationEmail,
                    password: 'wrongpassword'
                });

            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Invalid email or password');
        });
    });
});
