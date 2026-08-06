# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm install --include=dev

RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src

# Allocate 4GB RAM to Node so tsc doesn't crash the container, then build
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npx tsc && npx tsc-alias

# ---- Production Stage ----
FROM node:20-alpine AS runner

WORKDIR /app

# Ensure we create the system group and user properly
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 piki

COPY package.json package-lock.json ./
# Copy over the prisma directory just in case you need migration files at runtime
COPY --from=builder /app/prisma ./prisma
RUN npm install --production --no-audit --no-fund && npm cache clean --force

# Copy the compiled JS files from the builder
COPY --from=builder /app/dist ./dist

# Copy BOTH the client engine and the generated types from the builder
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# 🛠️ FIX 1: Change ownership of the ENTIRE /app folder to piki:nodejs
# This prevents permission errors if Node packages or Prisma try to write cache/logs to /app
RUN chown -R piki:nodejs /app

# 🛠️ FIX 2: Create the uploads directory and ensure it is explicitly owned by piki
RUN mkdir -p /app/uploads && chown -R piki:nodejs /app/uploads

USER piki

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]