import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Fallback URL for local `prisma migrate` — runtime uses DATABASE_URL from Docker env
    url: process.env.DATABASE_URL || 'postgresql://sanctuary:sanctuary@localhost:5432/sanctuary',
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
