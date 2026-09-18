const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

async function main() {
    console.log('Starting data migration...');
    try {
        // 1. Fetch all organizations with their auth data using raw query
        // We use raw query because the fields were removed from schema.prisma
        const orgs = await prisma.$queryRawUnsafe('SELECT * FROM Organization');
        console.log(`Found ${orgs.length} organizations to migrate.`);

        for (const org of orgs) {
            if (!org.organizationEmail || !org.password) {
                console.log(`Skipping organization ${org.organizationName} (${org.id}) - missing email or password.`);
                continue;
            }

            // 2. Check if an Admin with this email already exists
            let admin = await prisma.admin.findUnique({
                where: { email: org.organizationEmail }
            });

            if (!admin) {
                // 3. Create Admin record
                admin = await prisma.admin.create({
                    data: {
                        id: crypto.randomUUID(), // Generate a new UUID for the admin
                        email: org.organizationEmail,
                        password: org.password,
                        isVerified: org.isVerified === 1 || org.isVerified === true, // MySQL returns 1/0 for booleans
                        otp: org.otp,
                        otpExpires: org.otpExpires ? new Date(org.otpExpires) : null,
                        createdAt: org.createdAt ? new Date(org.createdAt) : new Date(),
                        updatedAt: new Date(),
                    }
                });
                console.log(`Created Admin for email: ${admin.email}`);
            } else {
                console.log(`Admin with email ${admin.email} already exists.`);
            }

            // 4. Map Admin to Organization via AdminRole
            const existingRole = await prisma.adminRole.findFirst({
                where: {
                    adminId: admin.id,
                    organizationId: org.id
                }
            });

            if (!existingRole) {
                await prisma.adminRole.create({
                    data: {
                        adminId: admin.id,
                        organizationId: org.id,
                        role: 'ADMIN'
                    }
                });
                console.log(`Assigned ADMIN role to ${admin.email} for organization ${org.organizationName}.`);
            } else {
                console.log(`Role mapping already exists for ${admin.email} and organization ${org.organizationName}.`);
            }
        }

        console.log('Data migration completed successfully.');

        // Note: To clean up the database completely, we will need to run:
        // npx prisma db push
        // This will drop the old columns (organizationEmail, password, isVerified, otp, otpExpires) from the Organization table.
    } catch (error) {
        console.error('Error during migration:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
