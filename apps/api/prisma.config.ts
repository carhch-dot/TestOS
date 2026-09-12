import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads config from package.json; the schema location and
// the Migrate/introspection datasource URL are declared here instead.
export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
