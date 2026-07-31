# Production image. Kept single-stage on purpose — simpler to read and debug
# at the cost of some image size.
FROM node:24-alpine

# Reservation times are stored as UTC instants but rendered/parsed against the
# club's local zone (see lib/dates.ts). Set it here so hosts that build straight
# from this Dockerfile still get the right zone; override via platform env vars.
ENV TZ=America/Los_Angeles

WORKDIR /app

# Install deps first so docker layer-caches them across code changes.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Generate the prisma client and build the app.
RUN npx prisma generate && npm run build

EXPOSE 3000

# `prisma migrate deploy` applies committed migrations (prisma/migrations/)
# without prompting — safe to run on every boot.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
