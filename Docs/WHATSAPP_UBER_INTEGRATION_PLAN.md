# WhatsApp Business API & Uber Direct Integration Plan

## Executive Summary

This document outlines the strategic plan to integrate **WhatsApp Business API** and **Uber Direct** into the Piki Food platform. This integration will enable customers to browse restaurants, view menus, place orders, make payments, and track deliveries entirely through WhatsApp—eliminating the need for app downloads and significantly expanding our market reach in Tanzania.

---

## Why WhatsApp Integration?

### Market Opportunity

- **WhatsApp Dominance**: WhatsApp is the primary messaging platform in Tanzania with over 90% smartphone penetration
- **Lower Barrier to Entry**: Customers can order without downloading an app
- **Familiar Interface**: Users interact with a platform they already use daily
- **Cost-Effective**: Meta's Cloud API offers competitive pricing (~$0.005 per utility message)

### Business Benefits

- **Increased Reach**: Tap into WhatsApp's massive user base
- **Higher Conversion**: Simplified ordering process reduces friction
- **Customer Retention**: Direct communication channel for promotions and updates
- **Competitive Advantage**: First-mover advantage in Tanzanian food delivery market

---

## Integration Architecture

### System Overview

```
Customer (WhatsApp)
    ↓
Meta WhatsApp Business Cloud API
    ↓ (Webhooks)
Piki Food Backend
    ↓
├─ WhatsApp Service (Message handling)
├─ Session Manager (Redis-based state)
├─ Auto-Registration (User creation)
├─ Conversation Handlers (Business logic)
│  ├─ Browse Restaurants
│  ├─ View Menu
│  ├─ Cart Management
│  ├─ Checkout & Payment
│  └─ Order Tracking
├─ Existing Services (Reused)
│  ├─ Restaurant Service
│  ├─ Order Service
│  ├─ Cart Service
│  ├─ Payment Service (ClickPesa)
│  └─ Notification Service
└─ Uber Direct Service (Phase 3)
```

### Key Design Decisions

| Decision               | Choice                      | Rationale                                  |
| ---------------------- | --------------------------- | ------------------------------------------ |
| **API Provider**       | Meta Cloud API (Direct)     | Cost-effective, no middleman, full control |
| **User Experience**    | Interactive Buttons & Lists | Guided flow, reliable, no NLP complexity   |
| **User Registration**  | Auto-register on first use  | Seamless onboarding, zero friction         |
| **Session Management** | Redis-based                 | Fast lookups, scalable, 24h TTL            |
| **Payments**           | ClickPesa USSD Push         | Leverage existing infrastructure           |
| **Delivery**           | Uber Direct                 | Professional last-mile delivery            |

---

## Implementation Phases

### Phase 1: WhatsApp Core (Browse & Order)

**Timeline: 2-3 weeks**

Enable customers to browse restaurants, view menus, and place orders through WhatsApp.

#### Features

- ✅ Auto-registration from WhatsApp phone number
- ✅ Browse featured and popular restaurants
- ✅ View restaurant menus with categories
- ✅ Add items to cart with quantity selection
- ✅ View and manage cart
- ✅ Place orders with delivery address
- ✅ Order confirmation messages

#### User Journey

```
1. Customer sends "Hi" to Piki Food WhatsApp number
2. System auto-registers customer (if new)
3. Welcome message with main menu buttons:
   - 🍽️ Browse Restaurants
   - 🛒 View Cart
   - 📦 My Orders
   - ℹ️ Help

4. Customer taps "Browse Restaurants"
5. System shows list of restaurants (max 10)
6. Customer selects a restaurant
7. System shows menu grouped by categories
8. Customer selects item → sees details → taps "Add to Cart"
9. Customer selects quantity (1-10 buttons)
10. System confirms addition, offers "Continue Browsing" or "View Cart"
11. Customer taps "View Cart" → sees cart summary
12. Customer taps "Proceed to Checkout"
13. System requests delivery address
14. Customer enters address
15. System shows order summary with total
16. Customer confirms order
17. System sends order confirmation with order number
```

#### Technical Components

- **Webhook Endpoint**: `POST /api/whatsapp/webhook`
- **WhatsApp Service**: Message sending/receiving
- **Session Manager**: Conversation state tracking
- **Message Handlers**: Start, Restaurants, Menu, Cart, Order
- **Database Models**: `WhatsAppSession`, `WhatsAppMessage`

---

### Phase 2: WhatsApp Payments (ClickPesa Integration)

**Timeline: 1 week**

Enable seamless mobile money payments through WhatsApp.

#### Features

- ✅ Display order summary with payment breakdown
- ✅ Collect payment phone number (or use saved number)
- ✅ Initiate ClickPesa USSD push
- ✅ Handle payment success/failure
- ✅ Send payment confirmation messages
- ✅ Retry failed payments

#### Payment Flow

```
1. Customer taps "Proceed to Checkout"
2. System shows order summary:
   - Items and quantities
   - Subtotal
   - Delivery fee
   - Service fee (3%)
   - Total amount

3. System requests payment phone number
4. Customer enters phone (e.g., 255712345678)
5. System: "We'll send a USSD push to 255XXXYYY. Enter PIN to confirm."
6. System initiates ClickPesa USSD push
7. Customer receives USSD prompt on phone
8. Customer enters mobile money PIN
9. ClickPesa sends webhook (success/failure)
10. On success:
    - System creates order
    - Sends confirmation: "Payment successful! Order #PIKI-123456 confirmed"
11. On failure:
    - System offers retry or cancellation
```

#### Error Handling

- **USSD Timeout**: Retry up to 3 times
- **Insufficient Funds**: Notify and offer alternative payment
- **Invalid Phone**: Request correct number
- **Network Failure**: Queue retry and notify customer

---

### Phase 3: Uber Direct Delivery Integration

**Timeline: 2 weeks**

Integrate Uber Direct for professional last-mile delivery with real-time tracking.

#### Features

- ✅ Get delivery quotes from Uber
- ✅ Create delivery requests automatically
- ✅ Real-time delivery status updates
- ✅ Driver information sharing
- ✅ Delivery tracking via WhatsApp
- ✅ Fallback to manual driver assignment

#### Delivery Flow

```
1. Order is confirmed and paid
2. System requests Uber delivery quote
3. System creates Uber delivery request
4. Uber assigns driver
5. System sends WhatsApp message:
   "Driver assigned! John (+255 XXX) is picking up your order"

6. Driver picks up order
7. System sends: "Order picked up! ETA: 15 minutes"
   - Includes tracking URL

8. Driver en route to customer
9. System sends: "Driver is on the way! Track here: [URL]"

10. Delivery completed
11. System sends: "Order delivered! Enjoy your meal 🍽️"
```

#### Fallback Strategy

If Uber Direct is unavailable:

- Use existing driver assignment system (BullMQ queue)
- Notify restaurant to arrange own delivery
- Offer pickup option to customer

#### Technical Components

- **Uber Service**: API client for Uber Direct
- **Webhook Handler**: `POST /api/uber/webhook`
- **Database Model**: `UberDelivery`
- **Integration**: Order creation triggers Uber delivery

---

### Phase 4: Advanced Features (Future)

**Timeline: TBD**

#### 4.1 Restaurant Reservations

```
Customer: "Book a table"
System: Shows restaurants with reservation option
Customer: Selects restaurant
System: Requests date and time
Customer: "Tomorrow 7pm"
System: Requests number of guests
Customer: "4 people"
System: Confirms reservation details
System: Sends confirmation with reservation ID
```

#### 4.2 Order Reordering

```
Customer: "Reorder"
System: Shows last 5 orders
Customer: Selects order
System: "Add all items to cart?"
Customer: "Yes"
System: Adds items and proceeds to checkout
```

#### 4.3 Loyalty Program

- Points for every order
- WhatsApp notifications for points balance
- Redeem points for discounts
- Special offers via WhatsApp templates

#### 4.4 Customer Support

- FAQ bot for common questions
- Escalation to human agent
- Order issue reporting
- Refund requests

---

## Database Schema Changes

### New Models

#### WhatsAppSession

Tracks conversation state for each WhatsApp user.

```prisma
model WhatsAppSession {
  id                String   @id @default(uuid())
  userId            String
  user              User     @relation(fields: [userId], references: [id])
  phoneNumber       String   @unique
  conversationState Json     @default("{}")
  lastMessageAt     DateTime @default(now())
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

#### WhatsAppMessage

Logs all WhatsApp messages for auditing and debugging.

```prisma
model WhatsAppMessage {
  id                String   @id @default(uuid())
  whatsappMessageId String   @unique
  sessionId         String
  session           WhatsAppSession @relation(fields: [sessionId], references: [id])
  direction         String   // "incoming" or "outgoing"
  messageType       String   // "text", "interactive", "template", etc.
  content           Json
  status            String?  // "sent", "delivered", "read", "failed"
  statusTimestamp   DateTime?
  createdAt         DateTime @default(now())
}
```

#### UberDelivery

Tracks Uber delivery status and details.

```prisma
model UberDelivery {
  id                String   @id @default(uuid())
  orderId           String   @unique
  order             Order    @relation(fields: [orderId], references: [id])
  uberDeliveryId    String?  @unique
  status            String   @default("pending")
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
}
```

### Updated Models

#### User Model (Additions)

```prisma
model User {
  // ... existing fields ...
  whatsappPhoneNumber  String?   @unique
  whatsappOptIn        Boolean   @default(false)
  whatsappSessions     WhatsAppSession[]
}
```

#### Order Model (Additions)

```prisma
model Order {
  // ... existing fields ...
  uberDelivery      UberDelivery?
}
```

---

## WhatsApp Message Templates

Message templates must be submitted to Meta for approval before use.

### 1. Order Confirmation

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
- View Order Details (URL)
```

### 2. Order Status Update

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

### 3. Payment Request

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

### 4. Delivery Update

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
- Track Delivery (URL)
- Call Driver (phone number)
```

---

## Security Considerations

### WhatsApp Webhook Security

- ✅ Validate `X-Hub-Signature-256` header on all webhook requests
- ✅ Use HTTPS for webhook endpoint
- ✅ Rate limit webhook endpoint (500 req/15min)
- ✅ Log all webhook payloads for debugging

### Uber API Security

- ✅ Store OAuth tokens securely (encrypted at rest)
- ✅ Use environment variables for credentials
- ✅ Validate webhook signatures
- ✅ Implement request signing for API calls

### Data Privacy

- ✅ Encrypt sensitive user data (phone numbers, addresses)
- ✅ Comply with GDPR/data protection regulations
- ✅ Provide opt-out mechanism for WhatsApp messages
- ✅ Delete conversation history on user request

---

## Performance & Scalability

### WhatsApp API Rate Limits

- **Limit**: 50 messages per second per phone number
- **Strategy**: Implement message queuing for bulk operations
- **Retry**: Use exponential backoff for failed requests

### Session Management

- **Storage**: Redis for fast session lookups
- **TTL**: 24 hours (clear inactive sessions)
- **Cleanup**: Periodic job to remove expired sessions

### Database Optimization

- **Indexes**: Phone number, order ID, session ID
- **Connection Pooling**: Already configured via Prisma
- **Read Replicas**: Consider for heavy read operations (future)

---

## Monitoring & Logging

### Key Metrics

| Metric                         | Target  | Alert Threshold |
| ------------------------------ | ------- | --------------- |
| WhatsApp message delivery rate | >95%    | <90%            |
| Conversation completion rate   | >80%    | <70%            |
| Payment success rate           | >90%    | <85%            |
| Uber delivery success rate     | >95%    | <90%            |
| Average delivery time          | <45 min | >60 min         |

### Logging Strategy

- ✅ Log all WhatsApp messages (incoming/outgoing)
- ✅ Log all Uber API calls
- ✅ Log conversation state transitions
- ✅ Log errors with full context
- ✅ Use structured logging (JSON format)

### Alerting

- 🚨 Webhook failures
- 🚨 Payment failures > 10%
- 🚨 Uber API errors
- 🚨 High message queue depth

---

## Cost Analysis

### WhatsApp Business API Costs

**Meta Cloud API Pricing** (as of 2024):

- **Marketing conversations**: ~$0.0250 per conversation (first 1,000 free/month)
- **Utility conversations**: ~$0.0050 per conversation (first 1,000 free/month)
- **Service conversations**: Free (user-initiated, 24h window)

**Estimated Monthly Cost** (10,000 orders):

- Utility messages (order confirmations, updates): ~$45
- Service messages (user interactions): Free
- **Total: ~$45/month**

### Uber Direct Costs

- **Per-delivery fee**: $3-8 (varies by distance and market)
- **Strategy**: Pass delivery fee to customer (add to order total)
- **Margin**: Can negotiate volume discounts with Uber

### Infrastructure Costs

- **Redis**: Already in use (no additional cost)
- **Database**: Minimal increase (~$5-10/month for additional storage)
- **Bandwidth**: Negligible (text-based messages)

### Total Estimated Monthly Cost

- **Fixed**: ~$50 (WhatsApp API + infrastructure)
- **Variable**: Uber delivery fees (passed to customer)

---

## Timeline & Milestones

### Phase 1: WhatsApp Core (Weeks 1-3)

- **Week 1**: Meta API setup, database schema, WhatsApp service
- **Week 2**: Message handlers, session management, webhook
- **Week 3**: Testing, bug fixes, deployment

**Milestone**: Customers can browse and order via WhatsApp

### Phase 2: Payments (Week 4)

- Payment handler integration
- ClickPesa webhook updates
- Testing and deployment

**Milestone**: Customers can pay via WhatsApp

### Phase 3: Uber Direct (Weeks 5-6)

- **Week 5**: Uber API integration, service implementation
- **Week 6**: Webhook handling, WhatsApp tracking, testing

**Milestone**: Automated delivery with real-time tracking

### Phase 4: Advanced Features (Future)

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

| Risk               | Mitigation                                    |
| ------------------ | --------------------------------------------- |
| Template rejection | Submit templates early, have backup templates |
| Account ban        | Follow WhatsApp policies, implement opt-out   |
| Rate limits        | Implement queuing and backoff strategies      |

### Uber API Risks

| Risk                   | Mitigation                                 |
| ---------------------- | ------------------------------------------ |
| API access denial      | Apply early, have fallback delivery system |
| Service unavailability | Implement circuit breaker pattern          |
| High costs             | Monitor costs, negotiate volume discounts  |

### Technical Risks

| Risk             | Mitigation                                  |
| ---------------- | ------------------------------------------- |
| Webhook failures | Implement retry logic and dead letter queue |
| Session loss     | Persist critical state to database          |
| Message ordering | Use timestamps and sequence numbers         |

---

## Prerequisites & Setup

### Meta WhatsApp Business API

1. Create Meta Business account
2. Create WhatsApp Business account
3. Get WhatsApp Business Phone Number ID
4. Get WhatsApp Business Account ID
5. Generate Permanent Access Token (System User Token)
6. Configure webhook URL: `https://yourdomain.com/api/whatsapp/webhook`
7. Subscribe to webhook events: `messages`, `message_status`
8. Verify webhook with challenge token
9. Submit message templates for approval

### Uber Direct API

1. Create Uber Developer account
2. Register application
3. Get Client ID and Client Secret
4. Request Uber Direct API access (may require approval)
5. Configure webhook URL for delivery updates
6. Set up sandbox environment for testing

### Environment Variables

```env
# WhatsApp Business API
WHATSAPP_API_VERSION=v19.0
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_account_id
WHATSAPP_ACCESS_TOKEN=your_permanent_access_token
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_custom_verify_token
WHATSAPP_WEBHOOK_SECRET=your_webhook_secret_for_validation

# Uber Direct API
UBER_CLIENT_ID=your_client_id
UBER_CLIENT_SECRET=your_client_secret
UBER_SERVER_TOKEN=your_server_token
UBER_SANDBOX_MODE=true
UBER_WEBHOOK_SECRET=your_webhook_secret
```

---

## Next Steps

### Immediate Actions (This Week)

1. ✅ Create Meta Business account
2. ✅ Apply for WhatsApp Business API access
3. ✅ Submit message templates for approval
4. ✅ Apply for Uber Direct API access
5. ✅ Set up development environment

### Development Setup (Week 1)

1. Set up WhatsApp sandbox environment
2. Create test phone numbers
3. Set up ngrok for local webhook testing
4. Prepare database migrations
5. Start Phase 1 implementation

### Launch Preparation

1. Test with internal team
2. Beta test with select customers
3. Monitor metrics and fix issues
4. Prepare marketing materials
5. Launch to public

---

## Conclusion

This WhatsApp and Uber integration will transform Piki Food into a leading food delivery platform in Tanzania by:

- **Expanding Reach**: Tap into WhatsApp's massive user base
- **Simplifying Ordering**: No app download required
- **Improving Experience**: Professional delivery with real-time tracking
- **Reducing Costs**: Competitive API pricing
- **Building Loyalty**: Direct communication channel

The phased approach minimizes risk while delivering value quickly. Phase 1 can be live in 3 weeks, with full integration (payments + delivery) complete in 6 weeks.

**Expected Impact**:

- 30-50% increase in order volume
- 20% reduction in customer acquisition cost
- 40% improvement in delivery success rate
- Enhanced customer satisfaction and retention

---

## Appendix

### File Structure

```
src/
├── routes/
│   └── whatsapp.ts                    # Webhook endpoint
├── services/
│   ├── whatsapp/
│   │   ├── whatsapp.service.ts        # Core WhatsApp API client
│   │   ├── whatsapp-webhook.service.ts # Webhook handler
│   │   ├── whatsapp-session.service.ts # Session management
│   │   ├── whatsapp-message.service.ts # Message formatting
│   │   └── handlers/
│   │       ├── index.ts               # Handler router
│   │       ├── start.handler.ts       # Welcome & main menu
│   │       ├── restaurants.handler.ts # Browse restaurants
│   │       ├── menu.handler.ts        # View menu items
│   │       ├── cart.handler.ts        # Cart operations
│   │       └── order.handler.ts       # Order placement
│   └── uber/
│       └── uber.service.ts            # Uber Direct API client
└── types/
    ├── whatsapp.types.ts              # WhatsApp API types
    └── uber.types.ts                  # Uber API types
```

### Resources

- [WhatsApp Business API Documentation](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Uber Direct API Documentation](https://developer.uber.com/docs/deliveries)
- [Meta Business Help Center](https://www.facebook.com/business/help)
- [ClickPesa API Documentation](https://clickpesa.com/api-documentation)

---

**Document Version**: 1.0  
**Last Updated**: September 5, 2026  
**Author**: Piki Food Development Team
