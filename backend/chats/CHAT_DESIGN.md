# Chat Design: One Chat Per Buyer-Seller (Social Commerce Style)

## Design Decision

**ONE CHAT PER BUYER-SELLER PAIR** (like Facebook Marketplace, WeChat)
- Not one chat per product
- Chat history persists across multiple purchases
- More personal, relationship-focused
- Matches Myanmar's social commerce culture

## User Flow

### First Time Buyer Chats with Seller
```
1. Buyer browses products
2. Buyer clicks "Chat with Seller" on Product A
3. System creates NEW chat (first time)
4. Buyer and seller chat about Product A
5. They complete purchase
```

### Buyer Wants to Buy Another Product
```
1. Buyer browses Product B (same seller)
2. Buyer clicks "Chat with Seller" on Product B
3. System returns EXISTING chat (same buyer-seller)
4. Chat history from Product A is still there
5. They chat about Product B
6. Seller can send Product B details in chat
7. Buyer pays and confirms in same chat
```

### Benefits
- **Personal relationship** - One conversation thread
- **Context preserved** - Previous conversations visible
- **Easier for sellers** - One chat per buyer to manage
- **More natural** - Like Facebook/WeChat messaging
- **Better UX** - Familiar to Myanmar users

## 🔧 Technical Implementation

### Chat Schema (Updated)
```javascript
{
  chatId: string,
  buyerId: string,
  sellerId: string,
  initialProductId: string | null,  //product that started the chat
  currentProductId: string | null,  //current product being discussed
  orderId: string | null,           //latest order (if any)
  status: "active" | "closed",
  createdAt: timestamp,
  updatedAt: timestamp,
  lastMessageAt: timestamp,
  lastMessage: string | null
}
```
### Message Schema (For Future)
```javascript
{
  messageId: string,
  chatId: string,
  senderId: string,
  senderRole: "buyer" | "seller",
  messageType: "text" | "image" | "order_proposal" | "order_confirmed",
  text: string | null,
  imageURL: string | null,
  productId: string | null,  //optional - which product is this message about?
  orderId: string | null,    //optional - which order is this message about?
  timestamp: timestamp,
  read: boolean
}
```

## User Experience

### Buyer Perspective
- Clicks "Chat" on any product from a seller
- Opens same chat if they've chatted before
- Sees full conversation history
- Feels like messaging a friend/seller
- Can discuss multiple products in one chat

### Seller Perspective
- One chat per buyer
- Easier to manage (less chats to track)
- Can see buyer's purchase history in one place
- Can send product suggestions easily
- More personal relationship

## 🔍 Dispute Resolution

**Question:** How do we track which product an order is for?

**Answer:** 
- Each **message** can have a `productId` field
- Each **order** has a `productId` field
- Each **order** is linked to chat via `chatId`
- We can filter messages by `productId` when needed
- Chat history shows all products, but we can filter for specific product

**For Disputes:**
- Order has `productId` and `chatId`
- We can get all messages in chat
- We can filter messages by `productId` if needed
- Full chat context is available

## Implementation Steps

1. ✅ **Update startChat** - One chat per buyer-seller (DONE)
2. ✅ **Update sendMessage** - Add optional productId to messages
3. ⏳ **Update getChatMessages** - Support filtering by productId (optional)
4. ⏳ **Update order creation** - Link order to chat and product
5. ⏳ **Frontend** - Show one chat per seller, filter by product if needed
