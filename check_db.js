const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const orgs = await prisma.$queryRawUnsafe('SELECT * FROM Organization LIMIT 1');
        console.log("Orgs: ", orgs);
    } catch (err) {
        console.error(err);
    } finally {
        await prisma.$disconnect();
    }
}
main();
