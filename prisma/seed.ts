/**
 * Seed script — creates the first admin plus clearly-marked demo data so the
 * platform can be explored end-to-end immediately.
 *
 *   bun run seed
 *
 * Demo credentials (change admin password after first login in production):
 *   admin@commhub.app  / Admin#2024Secure
 *   aisha@commhub.app  / Demo#2024Pass
 *   bilal@commhub.app  / Demo#2024Pass
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

async function main() {
  console.log('Seeding CommHub…')

  const adminPassword = await bcrypt.hash('Admin#2024Secure', 10)
  const demoPassword = await bcrypt.hash('Demo#2024Pass', 10)

  const admin = await db.user.upsert({
    where: { email: 'admin@commhub.app' },
    update: {},
    create: {
      email: 'admin@commhub.app',
      passwordHash: adminPassword,
      fullName: 'CommHub Team',
      username: 'commhub_admin',
      bio: 'Official CommHub administration account. We publish official announcements here.',
      role: 'admin',
      isVerified: true,
    },
  })

  const aisha = await db.user.upsert({
    where: { email: 'aisha@commhub.app' },
    update: {},
    create: {
      email: 'aisha@commhub.app',
      passwordHash: demoPassword,
      fullName: 'Aisha Khan',
      username: 'aisha.khan',
      bio: 'Digital artist sharing weekly Urdu calligraphy and sketching tips.',
      role: 'user',
      isVerified: true,
    },
  })

  const bilal = await db.user.upsert({
    where: { email: 'bilal@commhub.app' },
    update: {},
    create: {
      email: 'bilal@commhub.app',
      passwordHash: demoPassword,
      fullName: 'Bilal Ahmed',
      username: 'bilal.ahmed',
      bio: 'Community member. Cricket, tech and good coffee.',
      role: 'user',
      isVerified: false,
    },
  })

  const existingPosts = await db.post.count()
  if (existingPosts === 0) {
    await db.post.createMany({
      data: [
        {
          authorId: admin.id,
          content:
            'Welcome to CommHub! 🎉\n\nThis is your community home — read official announcements here, reach the admin team through private chat, and explore communities run by verified creators.\n\nکسٹمر سپورٹ اردو میں بھی دستیاب ہے۔',
        },
        {
          authorId: admin.id,
          content:
            'Community guidelines update:\n• Be respectful of all members\n• No spam or promotional flooding\n• Report anything inappropriate — every report is reviewed by our team\n\nVerified creators: your community posts are reviewed before publication to keep the platform safe.',
        },
      ],
    })
  }

  const existingCommunity = await db.community.findUnique({ where: { ownerId: aisha.id } })
  if (!existingCommunity) {
    await db.community.create({
      data: {
        ownerId: aisha.id,
        name: 'Aisha’s Art Corner',
        description:
          'Weekly Urdu calligraphy, brush-lettering tutorials and community art challenges. New artwork posts are reviewed by the admin team before appearing here.',
      },
    })
  }

  console.log('Seed complete.')
  console.log('  admin@commhub.app / Admin#2024Secure (admin)')
  console.log('  aisha@commhub.app / Demo#2024Pass (verified user with community)')
  console.log('  bilal@commhub.app / Demo#2024Pass (regular user)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
