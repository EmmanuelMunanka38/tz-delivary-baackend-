# Piki Food Backend

Production-ready backend for the Piki Food delivery mobile app. Built with **Express + TypeScript + PostgreSQL + Prisma**.

### Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Framework** | Express + TypeScript | Mature, well-understood, minimal abstraction. NestJS adds unnecessary overhead for this scope. Middleware-based architecture maps cleanly to the route structure. |
| **Database** | PostgreSQL | Relational integrity for orders/payments, geospatial queries for driver location, strong consistency. |
| **ORM** | Prisma | Type-safe queries, auto-generated client, declarative migrations, great DX with autocomplete. |
| **Real-time** | Socket.IO | Reliable WebSocket fallbacks, room-based broadcasting for order tracking. |
| **Auth** | JWT (access + refresh) + OTP | Stateless auth with refresh rotation. OTP via phone for mobile-friendly login (matching verify_otp screen). |
| **Queue** | BullMQ + Redis | Reliable background jobs for notifications, order timeouts. |
| **Payments** | Stripe (stub) | Industry standard, ready for production integration. |
| **Storage** | S3-compatible + local fallback | Adapter pattern for dev/prod parity. |
| **Validation** | Zod | Type-safe runtime validation, excellent error messages, Prisma-like DX. |

## Quick Start

### Prerequisites

- Node.js 20+
- Docker Desktop
- npm

### 1. Start infrastructure

```bash
docker compose -f docker-compose.dev.yml up postgres redis -d
```

### 2. Install and setup

```bash
npm install

# Copy environment
cp .env.example .env

# Run migrations
npx prisma migrate dev --name init

# Seed data
npm run db:seed
```

### 3. Start dev server

```bash
npm run dev
```

Server runs at `http://localhost:3000`. Health check: `http://localhost:3000/api/health`

## API Endpoints

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/send-otp` | Send OTP to phone | - |
| POST | `/api/auth/verify-otp` | Verify OTP and get tokens | - |
| POST | `/api/auth/refresh` | Refresh access token | - |
| GET | `/api/auth/profile` | Get user profile | JWT |
| PUT | `/api/auth/profile` | Update user profile | JWT |
| POST | `/api/auth/logout` | Logout (invalidate refresh) | JWT |

**Send OTP:**
```json
POST /api/auth/send-otp
{ "phone": "+255712345678" }
```

**Verify OTP:**
```json
POST /api/auth/verify-otp
{ "phone": "+255712345678", "code": "1234" }
// Response:
{
  "success": true,
  "data": {
    "user": { "id": "...", "phone": "...", "name": "", "role": "customer" },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

### Restaurants

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/restaurants` | List restaurants (filter: ?cuisine=&search=&isOpen=) | - |
| GET | `/api/restaurants/featured` | Top 5 featured restaurants | - |
| GET | `/api/restaurants/:id` | Restaurant detail + menu | - |
| GET | `/api/restaurants/:id/menu` | Restaurant menu items | - |
| POST | `/api/restaurants` | Create restaurant | Owner |
| PUT | `/api/restaurants/:id` | Update restaurant | Owner |
| POST | `/api/restaurants/:id/menu` | Add menu item | Owner |
| PUT | `/api/restaurants/menu/:menuId` | Update menu item | Owner |
| DELETE | `/api/restaurants/menu/:menuId` | Delete menu item | Owner |

### Cart

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/cart` | Get current cart | JWT |
| POST | `/api/cart/add` | Add item to cart | JWT |
| PUT | `/api/cart/items/:itemId` | Update item qty (0 to remove) | JWT |
| DELETE | `/api/cart/items/:itemId` | Remove item | JWT |
| DELETE | `/api/cart` | Clear cart | JWT |

### Orders

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/orders` | Create order | Customer |
| GET | `/api/orders` | List orders (role-based) | JWT |
| GET | `/api/orders/:id` | Get order detail | JWT |
| GET | `/api/orders/:id/track` | Get tracking info | JWT |
| PUT | `/api/orders/:id/status` | Update status | Owner/Driver |
| POST | `/api/orders/:id/cancel` | Cancel order | Customer |
| POST | `/api/orders/:id/reorder` | Reorder from history | Customer |

### Driver

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/driver/requests` | Available delivery requests | Driver |
| POST | `/api/driver/requests/:id/accept` | Accept delivery | Driver |
| GET | `/api/driver/active` | Get active delivery | Driver |
| GET | `/api/driver/dashboard` | Driver stats | Driver |

### Restaurant Owner

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/restaurant-owner/dashboard` | Owner dashboard stats | Owner |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories` | List food categories |
| GET | `/api/health` | Health check |
| GET | `/api/metrics` | Basic metrics |
| GET | `/api/users/drivers` | List available drivers |

## Real-time (Socket.IO)

### Connection

```js
const socket = io('http://localhost:3000', {
  auth: { token: 'your-access-token' }
});
```

### Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `track:order` | Client → Server | Start tracking an order |
| `leave:order` | Client → Server | Stop tracking |
| `location:update` | Client → Server | Driver sends location |
| `driver:location` | Server → Client | Driver location broadcast |
| `order:{id}:status` | Server → Client | Order status change |

### Order tracking flow:

```js
// Customer connects and tracks
socket.emit('track:order', orderId);
socket.on('order:status', (data) => {
  console.log('Status:', data.status, 'ETA:', data.estimatedMinutes);
});
socket.on('driver:location', (data) => {
  console.log('Driver at:', data.latitude, data.longitude);
});
```

## Auth Flow (Mobile App Integration)

1. **Onboarding/Login**: User enters phone → `POST /api/auth/send-otp`
2. **Verify OTP**: User enters 4-digit code → `POST /api/auth/verify-otp`
3. **Store tokens**: Save `accessToken` (15min) and `refreshToken` (7d) in secure storage
4. **API calls**: Include `Authorization: Bearer <accessToken>` header
5. **Token refresh**: When API returns 401, call `POST /api/auth/refresh` with `{ refreshToken }`
6. **Profile**: `GET /api/auth/profile` to populate My Profile screen
7. **Logout**: `POST /api/auth/logout` + clear stored tokens

## Payment Webhooks (Stub)

The backend includes a Stripe webhook-ready structure. Configure:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Webhook endpoint (to implement): `POST /api/webhooks/stripe`

## Push Notifications

Store FCM token after login via:
```json
PUT /api/auth/profile
{ "fcmToken": "your-fcm-device-token" }
```

Configure server key:
```env
FCM_SERVER_KEY=your-fcm-server-key
```

## File Storage

Uses adapter pattern. For local dev, files are stored in `./uploads/`. For production, configure S3:

```env
STORAGE_PROVIDER=s3
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_BUCKET=piki-food-uploads
```

## Testing

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## Docker Development

```bash
# Start all services
docker compose -f docker-compose.dev.yml up -d

# View logs
docker compose -f docker-compose.dev.yml logs -f api

# Stop
docker compose -f docker-compose.dev.yml down
```

## Production Build

```bash
# Build TypeScript
npm run build

# Start
node dist/index.js
```

## Project Structure

```
src/
├── index.ts           # Entry point, HTTP server + Socket.IO
├── app.ts             # Express app setup (middleware, routes)
├── config/            # Environment config
├── db/                # Prisma client singleton
├── middleware/         # Auth, validation, error handler, rate limiter
├── routes/            # Route handlers (controllers)
├── services/          # Business logic
├── socket/            # WebSocket event handlers
└── queue/             # BullMQ workers
prisma/
├── schema.prisma      # Database schema
└── seed.ts            # Seed data
tests/
├── services/          # Unit tests
└── integration/       # Integration tests
```

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`):
1. **Lint**: ESLint + Prettier check
2. **TypeCheck**: TypeScript compilation check
3. **Test**: Run tests with PostgreSQL service container
4. **Build**: Compile TypeScript
5. **Deploy**: (main branch only) Deploy to production

## Deployment Options

### AWS ECS
- Build Docker image, push to ECR
- Deploy to ECS Fargate with task definition
- Use RDS PostgreSQL + ElastiCache Redis

### Render
- Connect GitHub repo
- Set build command: `npm ci && npx prisma generate && npm run build`
- Set start command: `npx prisma migrate deploy && node dist/index.js`
- Add PostgreSQL and Redis addons

### DigitalOcean App Platform
- Connect repo, select Dockerfile
- Add managed PostgreSQL and Redis databases

## First Commit vs Follow-ups

### First commit (delivered):
- [x] Auth (JWT + refresh + OTP)
- [x] Users, restaurants, menus CRUD
- [x] Cart and checkout
- [x] Order creation and lifecycle
- [x] Real-time tracking (Socket.IO skeleton)
- [x] Docker + migrations + seed
- [x] Tests (unit + integration)
- [x] CI workflow
- [x] Comprehensive README

### Follow-ups:
- [ ] Stripe payment integration
- [ ] Production deploy scripts (AWS ECS / Render)
- [ ] Advanced monitoring (Sentry, Datadog)
- [ ] Performance tuning (caching, indexing)
- [ ] Admin dashboard API
- [ ] Geospatial queries for driver proximity
- [ ] Rate limiting per-user (Redis-based)
