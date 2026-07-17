// Seed the dev admin user. Run: bun /home/z/my-project/scripts/seed-admin.ts

import { db } from "../src/lib/db";
import bcrypt from "bcryptjs";

async function main() {
  const email = "admin@subsinhala.dev";
  const password = "admin123";
  const name = "Admin";

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    const updated = await db.user.update({
      where: { id: existing.id },
      data: {
        role: "ADMIN",
        passwordHash: await bcrypt.hash(password, 10),
        name,
      },
    });
    console.log(`✓ Updated existing user to ADMIN: ${updated.email}`);
  } else {
    const created = await db.user.create({
      data: {
        email,
        name,
        passwordHash: await bcrypt.hash(password, 10),
        role: "ADMIN",
      },
    });
    console.log(`✓ Created admin user: ${created.email}`);
  }

  // Also create a test FREE user to verify the quota system.
  const freeEmail = "free@test.com";
  const freeExisting = await db.user.findUnique({ where: { email: freeEmail } });
  if (!freeExisting) {
    await db.user.create({
      data: {
        email: freeEmail,
        name: "Free Test User",
        passwordHash: await bcrypt.hash("free123", 10),
        role: "FREE",
      },
    });
    console.log(`✓ Created free test user: ${freeEmail} (password: free123)`);
  } else {
    console.log(`✓ Free test user already exists: ${freeEmail}`);
  }

  console.log("\nAdmin login:");
  console.log(`  Email: ${email}`);
  console.log(`  Password: ${password}`);
  console.log("\nFree user login:");
  console.log(`  Email: ${freeEmail}`);
  console.log(`  Password: free123`);
}

main().catch(console.error);
