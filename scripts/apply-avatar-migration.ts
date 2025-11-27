import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Applying avatar_url migration...');
  
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE user_account
      ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    `);
    
    console.log('✅ Migration applied successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

