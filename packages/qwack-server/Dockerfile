FROM oven/bun:1 AS base
WORKDIR /app

# Copy pre-installed node_modules from the monorepo build context.
# This avoids a slow `bun install` inside Docker (AWS SDK = hundreds of packages).
COPY node_modules/ node_modules/

# Copy source code for server + shared (the only runtime packages)
COPY packages/qwack-server/ packages/qwack-server/
COPY packages/qwack-shared/ packages/qwack-shared/
COPY tsconfig.json ./

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

EXPOSE 4000

WORKDIR /app/packages/qwack-server
CMD ["bun", "run", "src/index.ts"]
