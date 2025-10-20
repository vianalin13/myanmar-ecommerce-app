# Myanmar E-Commerce App
**Secure, Transparent, and Conversational Online Shopping for Myanmar**

---

## Overview
This project aims to build a **trustworthy and mobile-first e-commerce platform** for Myanmar, addressing widespread challenges of **fraud, distrust, and unreliable transactions** in social-media-based online selling.

The app combines the **social interactivity of chat-based commerce** (like Facebook Marketplace) with **secure, verifiable transactions** and **localized payment integration**.

---

## Project Goals
- Provide a **centralized marketplace** for buyers and sellers in Myanmar  
- Ensure **transaction transparency** through logging and verification  
- Enable **safe communication** between verified users  
- Support **localized payments** (KBZPay, WavePay, Cash-on-Delivery)  
- Optimize for **low bandwidth and mobile-first usage**

---

## Target Users
| Role | Description |
|------|--------------|
| **Buyer** | Everyday consumers looking for safe, verified sellers |
| **Seller** | Small or medium vendors selling through social platforms |
| **Admin** | Platform moderators ensuring fair, transparent interactions |

---

## Core Features

### Shopping & Discovery
- Product listings (photos, prices, stock)
- Category filters, search, and wishlists  

### Social Chat Commerce
- Buyer-seller chat linked to each product
- Price negotiation and product Q&A
- Direct “Add to Cart” from chat  

### Localized Payments
- Cash-on-Delivery (default)
- KBZPay / WavePay integration
- Payment logs and receipts  

### Order Management
- Seller dashboard for inventory & sales  
- Buyer order tracking and delivery updates  

### Multilingual Interface
- Burmese (default), English, Mandarin  

### Security & Trust
- Verified vendor badges  
- Chat encryption and activity logs  
- Escrow payout and proof-of-delivery system  

---

## 🧾 Logging & Anti-Fraud System

All key actions are **timestamped and immutable** for transparency and dispute mediation.

**What’s Logged:**
- User accounts (phone number, device fingerprint, payment ID)
- Chats linked to Order IDs
- Product listings at time of sale
- Payment receipts and delivery confirmations

**Anti-Fraud Layers:**
- Mandatory phone verification (OTP)
- KYC for sellers over certain payout limits
- Escrow / delayed payouts for digital payments
- Courier confirmation for deliveries
- Reputation metrics and progressive seller sanctions

**Dispute Resolution Workflow:**
1. Buyer files dispute with order ID & evidence  
2. System retrieves logs and order data  
3. Admin reviews and decides outcome  
4. Refund or ban applied as needed  
5. Logs stored for transparency and audit

---

## Design & Documentation

### UI Mockups
Interactive Figma Prototype: [View in Figma](https://www.figma.com/design/W9E1xdT80TR1JcVrU0RkLd/shopping-app?node-id=0-1&t=JyUC5fUM5916nqt8-1)

**Preview:**
![UI Mockup Preview](docs/UI_Mockups.png)

### User Flow
![User Flow Diagram](docs/UserFlow.png)

### Sitemap
![Sitemap Diagram](docs/Sitemap.png)

### Data Models (ER Diagram)
![Data Model Diagram](docs/Data_Model.png)

---

## System Architecture

### **Frontend**
- **Framework:** Flutter *(priority)* or React Native  
- **Platforms:** Android (primary), iOS (scalable later)  
- **Design:** Offline-first, compressed images, caching, minimal animations

### **Backend**
- **Framework:** Node.js + Express *(or Django REST API)*  
- **Functions:** Authentication, product management, order tracking, payments  
- **Security:** JWT tokens, HTTPS
- **UI Inspiration:** Shopee (clean layout), Facebook Marketplace (social familiarity), Meesho (lightweight vendor inclusivity), Depop (chat-based flow)

### **Database Layer**
- **Chat:** Firebase Realtime Database / Firestore  
- **Core Data:** PostgreSQL / MongoDB  
- **Storage:** Firebase Storage / AWS S3 (images, receipts)

### **Authentication**
- Firebase Auth (SMS OTP)  
- Optional JWT role-based access  
- Seller KYC verification  
- Linked KBZPay/WavePay for payouts  

### **Cloud & Hosting**
- AWS / Google Cloud / Vercel  
- Firebase Functions or AWS Lambda for serverless logic  
- CDN for image optimization  


---

## Contributors
- [Viana](https://github.com/vianalin13)
- [Smile](https://github.com/ek3878)

