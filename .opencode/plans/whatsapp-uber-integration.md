# WhatsApp Business API & Uber Direct Integration Plan

## Overview

This document outlines the phased implementation plan for integrating WhatsApp Business API (Meta Cloud API) and Uber Direct delivery into the Piki Food platform, enabling users to browse restaurants, order food, make payments, and track deliveries entirely through WhatsApp conversations.

---

## Architecture Overview

### System Components

```
┌─────────────────┐
│  WhatsApp User  │
└────────┬────────┘
         │ Messages
         ▼
┌─────────────────────────────────────────┐
│  Meta WhatsApp Business Cloud API       │
│  (Webhooks: messages, status updates)   │
└────────┬────────────────────────────────┘
         │ Webhook POST
         ▼
┌─────────────────────────────────────────┐
│  Piki Food Backend                      │
│  ┌──────────────────────────────────┐  │
│  │ WhatsApp Webhook Endpoint        │  │
│  │ POST /api/whatsapp/webhook       │  │
│  └──────────┬───────────────────────┘  │
│             │                           │
│             ▼                           │
│  ┌──────────────────────────────────┐  │
│  │ WhatsApp Message Service         │  │
│  │ - Parse incoming messages        │  │
│  │ - Manage conversation state      │  │
│  │ - Route to appropriate handler   │  │
│  └──────────┬───────────────────────┘  │
│             │                           │
│             ├──────────────────┐        │
│             │                  │        │
│             ▼                  ▼        │
│  ┌──────────────────┐  ┌────────────┐  │
│  │ Session Manager  │  │ User Auto- │  │
│  │ (Redis)          │  │ Register   │  │
│  └────────┬─────────┘  └────────────┘  │
│           │                             │
│           ▼                             │
│  ┌──────────────────────────────────┐  │
│  │ Conversation Flow Handlers       │  │
│  │ - Browse Restaurants             │  │
│  │ - View Menu                      │  │
│  │ - Add to Cart                    │  │
│  │ - Checkout & Payment             │  │
│  │ - Order Tracking                 │  │
│  │ - Reservations (future)          │  │
│  └──────────┬───────────────────────┘  │
│             │                           │
│             ▼                           │
│  ┌──────────────────────────────────┐  │
│  │ Existing Services                │  │
│  │ - Restaurant Service             │  │
│  │ - Order Service                  │  │
│  │ - Cart Service                   │  │
│  │ - Payment Service (ClickPesa)    │  │
│  │ - Notification Service           │  │
│  └──────────┬───────────────────────┘  │
│             │                           │
│             ▼                           │
│  ┌──────────────────────────────────┐  │
│  │ Uber Direct Service (Phase 3)    │  │
│  │ - Create delivery requests       │  │
│  │ - Track delivery status          │  │
│  │ - Webhook handling               │  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Key Design Decisions

1. **Meta Cloud API (Direct)**: No middleman BSP, cost-effective, full control
2. **Interactive Messages**: Buttons and lists for guided UX (no NLP complexity)
3. **Auto-Registration**: Seamless onboarding from WhatsApp phone number
4. **Session Management**: Redis-based conversation state tracking
5. **ClickPesa USSD Push**: Leverage existing payment infrastructure
6. **Uber Direct**: Last-mile delivery integration for driver dispatch

---

## Phase 1: WhatsApp Core (Browse & Order)

### 1.1 Meta WhatsApp Business API Setup

#### Prerequisites

- [ ] Create Meta Business account
- [ ] Create WhatsApp Business account
- [ ] Get WhatsApp Business Phone Number ID
- [ ] Get WhatsApp Business Account ID
- [ ] Generate Permanent Access Token (System User Token)
- [ ] Configure webhook URL: `https://yourdomain.com/api/whatsapp/webhook`
- [ ] Subscribe to webhook events: `messages`, `message_status`
- [ ] Verify webhook with challenge token

#### Environment Variables (Add to `.env`)

```env
# WhatsApp Business API
WHATSAPP_API_VERSION=v19.0
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_account_id
WHATSAPP_ACCESS_TOKEN=your_permanent_access_token
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_custom_verify_token
WHATSAPP_WEBHOOK_SECRET=your_webhook_secret_for_validation
```

### 1.2 Database Schema Updates

#### New Models (Add to `prisma/schema.prisma`)

```prisma
model WhatsAppSession {
  id                String   @id @default(uuid())
  userId            String
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  phoneNumber       String   @unique
  conversationState Json     @default("{}")
  lastMessageAt     DateTime @default(now())
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([phoneNumber])
  @@index([userId])
}

model WhatsAppMessage {
  id                String   @id @default(uuid())
  whatsappMessageId String   @unique
  sessionId         String
  session           WhatsAppSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  direction         String   // "incoming" or "outgoing"
  messageType       String   // "text", "interactive", "template", "image", etc.
  content           Json
  status            String?  // "sent", "delivered", "read", "failed"
  statusTimestamp   DateTime?
  createdAt         DateTime @default(now())

  @@index([sessionId])
  @@index([whatsappMessageId])
}

model UberDelivery {
  id                String   @id @default(uuid())
  orderId           String   @unique
  order             Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  uberDeliveryId    String?  @unique
  status            String   @default("pending") // pending, pickup, dropoff, completed, cancelled
  courierName       String?
  courierPhone      String?
  pickupEta         DateTime?
  dropoffEta        DateTime?
  trackingUrl       String?
  cost              Float?
  currency          String   @default("TZS")
  metadata          Json?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([orderId])
  @@index([uberDeliveryId])
}
```

#### Update User Model

```prisma
model User {
  // ... existing fields ...
  whatsappPhoneNumber  String?   @unique
  whatsappOptIn        Boolean   @default(false)
  whatsappSessions     WhatsAppSession[]

  // ... existing relations ...
}
```

#### Update Order Model

```prisma
model Order {
  // ... existing fields ...
  uberDelivery      UberDelivery?

  // ... existing relations ...
}
```

### 1.3 WhatsApp Service Implementation

#### File Structure

```
src/
├── routes/
│   └── whatsapp.ts                    # Webhook endpoint
├── services/
│   ├── whatsapp/
│   │   ├── whatsapp.service.ts        # Core WhatsApp API client
│   │   ├── whatsapp-webhook.service.ts # Webhook handler
│   │   ├── whatsapp-session.service.ts # Session management
│   │   ├── whatsapp-message.service.ts # Message formatting & sending
│   │   └── handlers/
│   │       ├── index.ts               # Handler router
│   │       ├── start.handler.ts       # Welcome & main menu
│   │       ├── restaurants.handler.ts # Browse restaurants
│   │       ├── menu.handler.ts        # View menu items
│   │       ├── cart.handler.ts        # Cart operations
│   │       └── order.handler.ts       # Order placement
│   └── uber/
│       └── uber.service.ts            # Uber Direct API client (Phase 3)
└── types/
    ├── whatsapp.types.ts              # TypeScript types for WhatsApp API
    └── uber.types.ts                  # TypeScript types for Uber API
```

#### Core WhatsApp Service (`whatsapp.service.ts`)

```typescript
// Key responsibilities:
// - Send text messages
// - Send interactive messages (buttons, lists)
// - Send template messages (for notifications)
// - Send media messages (images for menu items)
// - Mark messages as read
// - Upload media to WhatsApp
// - Handle API errors and retries

// Key methods:
// - sendTextMessage(to: string, text: string)
// - sendInteractiveButtons(to: string, body: string, buttons: Button[])
// - sendInteractiveList(to: string, body: string, sections: ListSection[])
// - sendTemplateMessage(to: string, templateName: string, components: any[])
// - sendImageMessage(to: string, imageUrl: string, caption?: string)
// - markMessageAsRead(messageId: string)
```

#### Session Management (`whatsapp-session.service.ts`)

```typescript
// Key responsibilities:
// - Create/retrieve WhatsApp sessions
// - Track conversation state (which step user is at)
// - Store temporary data (selected restaurant, cart items)
// - Handle session expiration (clear after 24h inactivity)
// - Auto-register users from WhatsApp phone number

// Conversation states:
// - MAIN_MENU
// - BROWSE_RESTAURANTS
// - VIEW_MENU (with restaurantId)
// - VIEW_CART
// - CHECKOUT (with delivery address)
// - ORDER_CONFIRMATION
// - ORDER_TRACKING

// Key methods:
// - getOrCreateSession(phoneNumber: string): Promise<WhatsAppSession>
// - updateSessionState(sessionId: string, state: string, data?: any)
// - clearSession(sessionId: string)
// - autoRegisterUser(phoneNumber: string): Promise<User>
```

#### Message Handlers

**Start Handler (`start.handler.ts`)**

```typescript
// Triggered when user sends "hi", "hello", "start", or first message
// Actions:
// 1. Auto-register user if new
// 2. Send welcome message
// 3. Show main menu with buttons:
//    - 🍽️ Browse Restaurants
//    - 🛒 View Cart
//    - 📦 My Orders
//    - ℹ️ Help
```

**Restaurants Handler (`restaurants.handler.ts`)**

```typescript
// Handles restaurant browsing
// Actions:
// 1. Fetch featured/popular restaurants
// 2. Send list message (max 10 restaurants per list)
// 3. Each list item shows: restaurant name, cuisine type, rating
// 4. On restaurant selection, transition to menu handler
// 5. Provide "Back to Menu" button
```

**Menu Handler (`menu.handler.ts`)**

```typescript
// Handles menu viewing for selected restaurant
// Actions:
// 1. Fetch menu items for restaurant
// 2. Group by category
// 3. Send list message with categories as sections
// 4. Each item shows: name, price, short description
// 5. On item selection, show item details + "Add to Cart" button
// 6. Handle quantity selection (1-10 buttons)
// 7. Add to cart and show confirmation
// 8. Offer "Continue Browsing" or "View Cart"
```

**Cart Handler (`cart.handler.ts`)**

```typescript
// Handles cart operations
// Actions:
// 1. Fetch current cart
// 2. Display cart items with quantities and total
// 3. Provide buttons:
//    - "Add More Items" (back to menu)
//    - "Update Quantities" (list items to modify)
//    - "Remove Item" (list items to remove)
//    - "Proceed to Checkout"
// 4. Handle cart updates
```

**Order Handler (`order.handler.ts`)**

```typescript
// Handles checkout and order placement
// Actions:
// 1. Request delivery address (free text or saved addresses)
// 2. Show order summary (items, subtotal, delivery fee, service fee, total)
// 3. Request payment method (ClickPesa USSD push)
// 4. Request phone number for payment (if not saved)
// 5. Initiate ClickPesa USSD push
// 6. Send confirmation message with order number
// 7. Transition to order tracking
```

### 1.4 Webhook Implementation

#### Webhook Endpoint (`routes/whatsapp.ts`)

```typescript
// GET /api/whatsapp/webhook - Webhook verification
// POST /api/whatsapp/webhook - Receive messages and status updates

// Webhook validation:
// - Verify X-Hub-Signature-256 header
// - Validate verify token on GET request

// Message processing:
// 1. Parse incoming webhook payload
// 2. Extract message type and content
// 3. Route to appropriate handler based on:
//    - Message type (text, interactive, button reply, list reply)
//    - Conversation state (from session)
// 4. Handle message status updates (sent, delivered, read, failed)
// 5. Log all messages to database
```

### 1.5 Configuration Updates

#### Update `src/config/index.ts`

```typescript
export const config = {
  // ... existing config ...

  whatsapp: {
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v19.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN!,
    webhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET!,
  },

  uber: {
    clientId: process.env.UBER_CLIENT_ID!,
    clientSecret: process.env.UBER_CLIENT_SECRET!,
    serverToken: process.env.UBER_SERVER_TOKEN!,
    sandboxMode: process.env.UBER_SANDBOX_MODE === 'true',
    webhookSecret: process.env.UBER_WEBHOOK_SECRET!,
  },
};
```

### 1.6 Message Templates

#### Required WhatsApp Message Templates (Submit for Approval)

**1. Order Confirmation Template**

```
Template Name: order_confirmation
Language: en_US
Type: Utility

Header: Order Confirmed! 🎉
Body: Your order {{1}} has been placed successfully.

Total: {{2}} TZS
Estimated delivery: {{3}}

You can track your order status by replying "track" or clicking the button below.

Buttons:
- Track Order (quick reply)
- View Order Details (URL: https://pikifood.app/orders/{{1}})
```

**2. Order Status Update Template**

```
Template Name: order_status_update
Language: en_US
Type: Utility

Header: Order Update
Body: Your order {{1}} status has changed to: {{2}}

{{3}}

Buttons:
- Track Order (quick reply)
- Contact Support (phone number)
```

**3. Payment Request Template**

```
Template Name: payment_request
Language: en_US
Type: Utility

Header: Payment Required
Body: Please complete payment for your order {{1}}

Amount: {{2}} TZS

You will receive a USSD push notification on {{3}} to complete the payment.

Buttons:
- Retry Payment (quick reply)
- Cancel Order (quick reply)
```

**4. Delivery Update Template**

```
Template Name: delivery_update
Language: en_US
Type: Utility

Header: Delivery Update
Body: {{1}}

Order: {{2}}
Driver: {{3}}
Phone: {{4}}

Buttons:
- Track Delivery (URL: {{5}})
- Call Driver (phone number: {{4}})
```

### 1.7 Testing Strategy

#### Unit Tests

- WhatsApp message parsing
- Session state transitions
- Auto-registration logic
- Message formatting

#### Integration Tests

- Webhook endpoint verification
- Message sending (mock WhatsApp API)
- Order flow end-to-end (mock external services)

#### Manual Testing

- Test with real WhatsApp account
- Verify all interactive flows
- Test edge cases (network failures, invalid inputs)
- Test message templates

### 1.8 Deployment Checklist

- [ ] Run database migrations
- [ ] Set environment variables in production
- [ ] Configure webhook URL in Meta Business dashboard
- [ ] Submit message templates for approval
- [ ] Test webhook connectivity
- [ ] Monitor first few conversations for issues
- [ ] Set up error tracking (Sentry, etc.)
- [ ] Configure logging for WhatsApp messages

---

## Phase 2: WhatsApp Payments (ClickPesa Integration)

### 2.1 Payment Flow

#### Conversation Flow

```
User: "Proceed to Checkout"
  ↓
Bot: Show order summary
  ↓
Bot: Request payment phone number (or use saved number)
  ↓
Bot: "We'll send a USSD push to 255XXXYYY. Please enter your PIN to confirm."
  ↓
Backend: Initiate ClickPesa USSD push
  ↓
User: Receives USSD prompt, enters PIN
  ↓
ClickPesa: Webhook callback (success/failure)
  ↓
Bot: Send payment confirmation or retry prompt
  ↓
Bot: Send order confirmation with order number
```

### 2.2 Implementation Details

#### Payment Handler (`payment.handler.ts`)

```typescript
// Key responsibilities:
// - Display order summary
// - Collect payment phone number
// - Validate phone number format
// - Initiate ClickPesa USSD push
// - Handle payment webhook callbacks
// - Send payment confirmation/failure messages
// - Handle retries and cancellations

// Integration with existing payment.service.ts:
// - Use existing ClickPesa token management
// - Use existing checksum generation
// - Add WhatsApp-specific status updates
```

#### Webhook Integration

```typescript
// Update ClickPesa webhook handler to:
// 1. Detect if order was placed via WhatsApp
// 2. Send payment status update via WhatsApp
// 3. On success: trigger order creation and confirmation
// 4. On failure: offer retry or cancellation
```

### 2.3 Error Handling

#### Common Scenarios

- **USSD push timeout**: Retry up to 3 times, then offer alternative payment
- **Insufficient funds**: Notify user and offer to cancel or try different number
- **Network failure**: Queue retry and notify user
- **Invalid phone**: Request correct phone number

---

## Phase 3: Uber Direct Delivery Integration

### 3.1 Uber Direct API Setup

#### Prerequisites

- [ ] Create Uber Developer account
- [ ] Register application
- [ ] Get Client ID and Client Secret
- [ ] Request Uber Direct API access (may require approval)
- [ ] Configure webhook URL for delivery updates
- [ ] Set up sandbox environment for testing

#### Environment Variables

```env
# Uber Direct API
UBER_CLIENT_ID=your_client_id
UBER_CLIENT_SECRET=your_client_secret
UBER_SERVER_TOKEN=your_server_token
UBER_SANDBOX_MODE=true
UBER_WEBHOOK_SECRET=your_webhook_secret
```

### 3.2 Uber Service Implementation

#### Uber Service (`uber.service.ts`)

```typescript
// Key responsibilities:
// - Authenticate with Uber API (OAuth 2.0)
// - Create delivery requests
// - Get delivery quotes (price, ETA)
// - Track delivery status
// - Handle Uber webhooks
// - Cancel deliveries

// Key methods:
// - getQuote(pickup, dropoff): Promise<Quote>
// - createDelivery(orderId, pickup, dropoff): Promise<UberDelivery>
// - getDeliveryStatus(deliveryId): Promise<DeliveryStatus>
// - cancelDelivery(deliveryId): Promise<void>
// - getTrackingUrl(deliveryId): Promise<string>

// API endpoints:
// POST /v1/deliveries/quote
// POST /v1/deliveries
// GET /v1/deliveries/{id}
// POST /v1/deliveries/{id}/cancel
```

### 3.3 Integration with Order Flow

#### Order Creation Update

```typescript
// After order is confirmed and paid:
// 1. Get Uber delivery quote
// 2. Create Uber delivery request
// 3. Store Uber delivery ID in database
// 4. Update order with estimated delivery time
// 5. Send WhatsApp message with delivery ETA
```

#### Webhook Handler

```typescript
// POST /api/uber/webhook
// Handle delivery status updates:
// - pickup: Driver assigned, en route to restaurant
// - dropoff: Picked up, en route to customer
// - completed: Delivered successfully
// - cancelled: Delivery cancelled

// Actions:
// 1. Update UberDelivery record
// 2. Update Order status
// 3. Send WhatsApp notification to customer
// 4. Emit Socket.IO events for real-time tracking
```

### 3.4 WhatsApp Delivery Tracking

#### Tracking Flow

```
User: "Track my order"
  ↓
Bot: Fetch latest order with Uber delivery
  ↓
Bot: Send delivery status message:
  - Driver name and phone
  - Current status (pickup/dropoff)
  - ETA
  - Tracking URL (Uber tracking page)
  ↓
Bot: Offer buttons:
  - "Refresh Status"
  - "Call Driver"
  - "View on Map" (URL)
```

### 3.5 Fallback Strategy

#### When Uber Direct is Unavailable

- Use existing driver assignment system (BullMQ queue)
- Notify restaurant to arrange own delivery
- Offer pickup option to customer

---

## Phase 4: Advanced Features (Future)

### 4.1 Restaurant Reservations

#### Conversation Flow

```
User: "Book a table"
  ↓
Bot: Show restaurants with reservation option
  ↓
User: Select restaurant
  ↓
Bot: Request date and time
  ↓
User: "Tomorrow 7pm"
  ↓
Bot: Request number of guests
  ↓
User: "4 people"
  ↓
Bot: Confirm reservation details
  ↓
Bot: Send confirmation with reservation ID
```

#### Database Schema

```prisma
model Reservation {
  id              String   @id @default(uuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  restaurantId    String
  restaurant      Restaurant @relation(fields: [restaurantId], references: [id])
  date            DateTime
  time            String
  guests          Int
  status          String   @default("pending") // pending, confirmed, cancelled, completed
  specialRequests String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([userId])
  @@index([restaurantId])
  @@index([date])
}
```

### 4.2 Order Reordering

#### Conversation Flow

```
User: "Reorder"
  ↓
Bot: Show last 5 orders
  ↓
User: Select order
  ↓
Bot: Confirm items and restaurant
  ↓
Bot: "Add all items to cart?"
  ↓
User: "Yes"
  ↓
Bot: Add items to cart and proceed to checkout
```

### 4.3 Loyalty Program

#### Features

- Points for every order
- WhatsApp notifications for points balance
- Redeem points for discounts
- Special offers via WhatsApp templates

### 4.4 Customer Support

#### Features

- FAQ bot (common questions)
- Escalate to human agent
- Order issue reporting
- Refund requests

---

## Security Considerations

### WhatsApp Webhook Security

- Validate X-Hub-Signature-256 header on all webhook requests
- Use HTTPS for webhook endpoint
- Rate limit webhook endpoint
- Log all webhook payloads for debugging

### Uber API Security

- Store OAuth tokens securely (encrypted at rest)
- Use environment variables for credentials
- Validate webhook signatures
- Implement request signing for API calls

### Data Privacy

- Encrypt sensitive user data (phone numbers, addresses)
- Comply with GDPR/data protection regulations
- Provide opt-out mechanism for WhatsApp messages
- Delete conversation history on user request

---

## Performance Considerations

### WhatsApp API Rate Limits

- 50 messages per second per phone number
- Implement message queuing for bulk operations
- Use exponential backoff for retries

### Session Management

- Use Redis for fast session lookups
- Set session TTL to 24 hours
- Clean up expired sessions periodically

### Database Optimization

- Index frequently queried fields (phone number, order ID)
- Use connection pooling
- Implement read replicas for heavy read operations

---

## Monitoring & Logging

### Key Metrics to Track

- WhatsApp message delivery rate
- Conversation completion rate
- Average conversation duration
- Payment success rate
- Uber delivery success rate
- Average delivery time

### Logging Strategy

- Log all WhatsApp messages (incoming/outgoing)
- Log all Uber API calls
- Log conversation state transitions
- Log errors with full context
- Use structured logging (JSON)

### Alerting

- Alert on webhook failures
- Alert on payment failures > 10%
- Alert on Uber API errors
- Alert on high message queue depth

---

## Cost Estimation

### WhatsApp Business API Costs (Meta Cloud API)

- **Conversation-based pricing** (as of 2024):
  - Marketing conversations: ~$0.0250 per conversation (first 1,000 free/month)
  - Utility conversations: ~$0.0050 per conversation (first 1,000 free/month)
  - Service conversations: Free (user-initiated, 24h window)
- **Estimated monthly cost** (10,000 orders):
  - Utility (order confirmations): ~$45 (9,000 × $0.0050)
  - Service (user interactions): Free
  - **Total: ~$45/month**

### Uber Direct Costs

- **Per-delivery fee**: Varies by distance and market
- **Estimated cost**: $3-8 per delivery (Tanzania market)
- **Pass to customer**: Add delivery fee to order total

### Infrastructure Costs

- **Redis**: Already in use (no additional cost)
- **Database**: Minimal increase (WhatsApp sessions, messages)
- **Bandwidth**: Negligible (text-based messages)

---

## Timeline Estimate

### Phase 1: WhatsApp Core (2-3 weeks)

- Week 1: Meta API setup, database schema, WhatsApp service
- Week 2: Message handlers, session management, webhook
- Week 3: Testing, bug fixes, deployment

### Phase 2: Payments (1 week)

- Payment handler integration
- ClickPesa webhook updates
- Testing and deployment

### Phase 3: Uber Direct (2 weeks)

- Week 1: Uber API integration, service implementation
- Week 2: Webhook handling, WhatsApp tracking, testing

### Phase 4: Advanced Features (TBD)

- Reservations: 1-2 weeks
- Reordering: 1 week
- Loyalty program: 2-3 weeks

**Total estimated time: 5-6 weeks for Phases 1-3**

---

## Success Metrics

### Phase 1 Success Criteria

- [ ] Users can browse restaurants via WhatsApp
- [ ] Users can view menus and add items to cart
- [ ] Users can place orders successfully
- [ ] Auto-registration works seamlessly
- [ ] Message delivery rate > 95%

### Phase 2 Success Criteria

- [ ] ClickPesa USSD push works via WhatsApp
- [ ] Payment success rate > 90%
- [ ] Failed payments can be retried
- [ ] Order confirmation sent automatically

### Phase 3 Success Criteria

- [ ] Uber deliveries created successfully
- [ ] Real-time tracking updates sent via WhatsApp
- [ ] Delivery success rate > 95%
- [ ] Fallback to manual driver assignment works

---

## Risk Mitigation

### WhatsApp API Risks

- **Template rejection**: Submit templates early, have backup templates
- **Account ban**: Follow WhatsApp policies, implement opt-out
- **Rate limits**: Implement queuing and backoff strategies

### Uber API Risks

- **API access denial**: Apply early, have fallback delivery system
- **Service unavailability**: Implement circuit breaker pattern
- **High costs**: Monitor costs, negotiate volume discounts

### Technical Risks

- **Webhook failures**: Implement retry logic and dead letter queue
- **Session loss**: Persist critical state to database
- **Message ordering**: Use timestamps and sequence numbers

---

## Next Steps

1. **Immediate Actions**:
   - Create Meta Business account
   - Apply for WhatsApp Business API access
   - Submit message templates for approval
   - Apply for Uber Direct API access

2. **Development Setup**:
   - Set up WhatsApp sandbox environment
   - Create test phone numbers
   - Set up ngrok for local webhook testing
   - Prepare database migrations

3. **Start Phase 1**:
   - Implement WhatsApp webhook endpoint
   - Build core WhatsApp service
   - Implement session management
   - Build message handlers

---

## Conclusion

This phased approach allows us to:

- Deliver value quickly (Phase 1 in 2-3 weeks)
- Minimize risk by building incrementally
- Leverage existing infrastructure (ClickPesa, order system)
- Provide fallback options (manual driver assignment)
- Scale to advanced features over time

The WhatsApp integration will significantly expand Piki Food's reach by allowing users to order food without downloading an app, using a platform they already use daily.
