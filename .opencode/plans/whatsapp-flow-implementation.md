# WhatsApp Flow JSON Implementation Plan

## Overview

Create a professional WhatsApp Flow JSON for Piki Food with 8 screens, white/green color scheme (#00A884), and dynamic data exchange with backend API endpoints.

## Flow Structure

### Screens (8 total)

#### 1. MAIN_MENU

- **Purpose**: Welcome screen with navigation options
- **Components**:
  - Header: "🍽️ Piki Food"
  - Subheading: Dynamic greeting with user name
  - Body: "Hello {user_name}! What would you like to do today?"
  - 4 Buttons (filled/outlined style, green #00A884):
    - 🍽️ Order Food → BROWSE_RESTAURANTS
    - 📦 Track My Order → ORDER_TRACKING
    - 📋 My Orders → MY_ORDERS
    - 🛒 View Cart → CART
- **Data Required**: `greeting`, `user_name`

#### 2. BROWSE_RESTAURANTS

- **Purpose**: Display list of available restaurants
- **Components**:
  - Header: "🍽️ Choose a Restaurant"
  - Subheading: "Select a restaurant to view their menu"
  - ListItems: Dynamic restaurant list with:
    - Restaurant name (heading)
    - Cuisine type, rating, delivery time (body)
    - Delivery fee (caption)
  - Footer: "← Back to Menu" button
- **Data Required**: `restaurants[]` array with:
  - id, name, cuisine, rating, delivery_time, delivery_fee, image_url
- **Action**: Select restaurant → RESTAURANT_MENU (pass restaurant_id)

#### 3. RESTAURANT_MENU

- **Purpose**: Display menu items grouped by category
- **Components**:
  - Header: "📋 {restaurant_name}"
  - Subheading: "Select items to add to your cart"
  - Nested ListItems:
    - Category name (heading)
    - Menu items with name, description, price
  - Footer: "← Back" + "View Cart 🛒" buttons
- **Data Required**: `restaurant_name`, `menu_categories[]` with nested items:
  - category_name, items[] (id, name, description, price, image_url)
- **Action**: Select item → Update cart data

#### 4. CART

- **Purpose**: Display cart items and order summary
- **Components**:
  - Header: "🛒 Your Cart"
  - Subheading: Restaurant name
  - ListItems: Cart items with quantity and subtotal
  - Summary section:
    - Subtotal, Delivery Fee, Service Fee
    - Total (highlighted in green)
  - Footer: "← Continue Shopping" + "Checkout ✓" buttons
- **Data Required**: `cart_items[]`, `subtotal`, `delivery_fee`, `service_fee`, `total`, `restaurant_name`
- **Action**: Checkout → DELIVERY_DETAILS

#### 5. DELIVERY_DETAILS

- **Purpose**: Collect delivery address and phone number
- **Components**:
  - Header: "📍 Delivery Details"
  - Subheading: "Where should we deliver your order?"
  - TextInput: Delivery address (text, required)
  - TextInput: Phone number (number, required)
  - Footer: "← Back to Cart" + "Continue to Payment" buttons
- **Data Required**: `user_phone`, `user_address` (pre-filled)
- **Action**: Continue → PAYMENT (pass address and phone)

#### 6. PAYMENT

- **Purpose**: Display payment summary and trigger ClickPesa
- **Components**:
  - Header: "💳 Payment"
  - Subheading: "Complete your order"
  - Order details: order number, total amount, delivery address
  - Payment method: Mobile Money (ClickPesa)
  - USSD push notification message
  - Footer: "← Back" + "Pay Now 💳" buttons
- **Data Required**: `total_amount`, `delivery_address`, `delivery_phone`, `order_number`
- **Action**: Pay Now → Data exchange to `process_payment` endpoint

#### 7. ORDER_TRACKING

- **Purpose**: Real-time order status tracking
- **Components**:
  - Header: "📦 Order Tracking"
  - Subheading: Order number
  - Restaurant name
  - Estimated delivery time (green highlight)
  - Status steps list with checkmarks:
    - ✓ completed steps (green)
    - ● active step (green)
    - ○ pending steps (gray)
  - Driver info: name and phone
  - Footer: "← Back to Menu" + "Refresh Status" buttons
- **Data Required**: `order_number`, `order_status`, `restaurant_name`, `estimated_time`, `driver_name`, `driver_phone`, `status_steps[]`
- **Action**: Refresh → Data exchange to `refresh_order_status` endpoint

#### 8. MY_ORDERS

- **Purpose**: Display order history
- **Terminal**: true (flow ends here)
- **Components**:
  - Header: "📋 My Orders"
  - Subheading: "Your recent orders"
  - ListItems: Orders with:
    - Order number (heading)
    - Restaurant name (body)
    - Total and status (green)
    - Created date (caption)
  - Footer: "← Back to Menu" button
- **Data Required**: `orders[]` with order_number, restaurant_name, total, status, created_at
- **Action**: Select order → ORDER_TRACKING

## Color Scheme

- **Primary**: #00A884 (WhatsApp Green)
- **Text**: #000000 (Black)
- **Background**: #FFFFFF (White)
- **Inactive**: #666666 (Gray)

## Data Exchange Endpoints

### 1. GET /api/whatsapp/flow/restaurants

**Request**:

```json
{
  "action": "get_restaurants",
  "user_id": "string"
}
```

**Response**:

```json
{
  "restaurants": [
    {
      "id": "rest_001",
      "name": "Pizza Palace",
      "cuisine": "Italian",
      "rating": 4.5,
      "delivery_time": "30-45 min",
      "delivery_fee": 3000,
      "image_url": "https://..."
    }
  ]
}
```

### 2. GET /api/whatsapp/flow/menu

**Request**:

```json
{
  "action": "get_menu",
  "restaurant_id": "rest_001"
}
```

**Response**:

```json
{
  "restaurant_name": "Pizza Palace",
  "menu_categories": [
    {
      "category_name": "Pizzas",
      "items": [
        {
          "id": "item_001",
          "name": "Margherita Pizza",
          "description": "Classic tomato and mozzarella",
          "price": 15000,
          "image_url": "https://..."
        }
      ]
    }
  ]
}
```

### 3. GET /api/whatsapp/flow/cart

**Request**:

```json
{
  "action": "get_cart",
  "user_id": "string"
}
```

**Response**:

```json
{
  "cart_items": [
    {
      "id": "cart_item_001",
      "name": "Margherita Pizza",
      "quantity": 2,
      "price": 15000,
      "subtotal": 30000
    }
  ],
  "subtotal": 30000,
  "delivery_fee": 3000,
  "service_fee": 900,
  "total": 33900,
  "restaurant_name": "Pizza Palace"
}
```

### 4. POST /api/whatsapp/flow/cart/add

**Request**:

```json
{
  "action": "add_to_cart",
  "user_id": "string",
  "item_id": "item_001",
  "quantity": 1
}
```

**Response**:

```json
{
  "success": true,
  "cart": { ... }
}
```

### 5. POST /api/whatsapp/flow/payment

**Request**:

```json
{
  "action": "process_payment",
  "order_number": "PIKI-123456",
  "total_amount": 33900,
  "delivery_address": "Mikocheni, Dar es Salaam",
  "delivery_phone": "255712345678"
}
```

**Response**:

```json
{
  "success": true,
  "order_number": "PIKI-123456",
  "payment_status": "pending",
  "message": "USSD push sent to 255712345678"
}
```

### 6. GET /api/whatsapp/flow/order/status

**Request**:

```json
{
  "action": "get_order_status",
  "order_number": "PIKI-123456"
}
```

**Response**:

```json
{
  "order_number": "PIKI-123456",
  "order_status": "preparing",
  "restaurant_name": "Pizza Palace",
  "estimated_time": "25-35 min",
  "driver_name": "John",
  "driver_phone": "255712345678",
  "status_steps": [
    {
      "step": "Order Placed",
      "completed": true,
      "active": false
    },
    {
      "step": "Preparing",
      "completed": false,
      "active": true
    }
  ]
}
```

### 7. POST /api/whatsapp/flow/order/refresh

**Request**:

```json
{
  "action": "refresh_order_status",
  "order_number": "PIKI-123456"
}
```

**Response**: Same as order/status

### 8. GET /api/whatsapp/flow/orders

**Request**:

```json
{
  "action": "get_my_orders",
  "user_id": "string"
}
```

**Response**:

```json
{
  "orders": [
    {
      "order_number": "PIKI-123456",
      "restaurant_name": "Pizza Palace",
      "total": 33900,
      "status": "delivered",
      "created_at": "2024-01-15 14:30"
    }
  ]
}
```

## Implementation Steps

### Step 1: Create Flow JSON File

- File: `src/whatsapp-flows/piki-food-flow.json`
- Structure: 8 screens with layouts, components, and data bindings
- Version: 6.0 (WhatsApp Flows API)

### Step 2: Create Backend API Endpoints

- File: `src/routes/whatsapp-flow.ts`
- Create 8 endpoints for data exchange
- Integrate with existing services:
  - Restaurant service
  - Cart service
  - Order service
  - Payment service (ClickPesa)

### Step 3: Update WhatsApp Service

- Add method to send flow message
- Method: `sendFlowMessage(phoneNumber, flowId, screenId, data)`
- Use WhatsApp Cloud API to send flow

### Step 4: Update Webhook Handler

- Handle flow data exchange requests
- Route to appropriate endpoint based on action
- Return formatted response for WhatsApp Flow

### Step 5: Register Flow with Meta

- Upload flow JSON to Meta Business Manager
- Get flow ID
- Update webhook to trigger flow on specific keywords

### Step 6: Test Flow

- Send "order" or "menu" to WhatsApp number
- Verify flow opens correctly
- Test all 8 screens
- Test data exchange with backend
- Verify payment flow with ClickPesa

## File Structure

```
src/
├── whatsapp-flows/
│   └── piki-food-flow.json          # Flow definition
├── routes/
│   └── whatsapp-flow.ts             # Data exchange endpoints
└── services/
    └── whatsapp/
        └── whatsapp.service.ts      # Add sendFlowMessage method
```

## Testing Checklist

- [ ] Flow JSON validates against WhatsApp schema
- [ ] All 8 screens render correctly
- [ ] Navigation between screens works
- [ ] Data exchange endpoints return correct format
- [ ] Restaurant list loads from database
- [ ] Menu items display correctly
- [ ] Cart updates work
- [ ] Payment triggers ClickPesa USSD push
- [ ] Order tracking shows real-time status
- [ ] Order history displays correctly
- [ ] Color scheme is white/green (#00A884)
- [ ] Flow works on iOS and Android WhatsApp

## Notes

- Flow JSON must follow WhatsApp Flow Spec v6.0
- All data exchange endpoints must respond within 3 seconds
- Use existing authentication (extract user from WhatsApp phone number)
- Reuse existing services (restaurant, cart, order, payment)
- Flow is triggered when user sends "order", "menu", or "start"
- Terminal screen: MY_ORDERS (flow ends after viewing orders)
