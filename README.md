# Aura SVG Studio - Advanced Admin & Auth API

This is the extended Authentication, Licensing, and Admin Backend for the Aura SVG Studio Electron Application. 

## Workflow Flow
1. **Customer Contacts Admin** -> Pays manually.
2. **Admin Creates Account** -> Server auto-generates a secure password and License Key (e.g. `SVG-XXXX-XXXX-XXXX-XXXX`).
3. **Admin Activates Subscription** -> Expiry date is set.
4. **Admin Shares Credentials** -> Customer logs into Electron App.
5. **App Validation** -> App checks subscription and validates Device limits.

## Project Structure
```
api/
├── config/db.js                  # MongoDB connection
├── controllers/
│   ├── authController.js         # Public Login, License Check
│   ├── adminController.js        # Admin User Management
│   └── userController.js         # Device & Subscription endpoints
├── middleware/
│   ├── adminMiddleware.js        # Validates if requester is an Admin
│   ├── authMiddleware.js         # Validates JWT tokens
│   ├── deviceMiddleware.js       # Validates if device is authorized
│   └── subscriptionMiddleware.js # Validates if subscription is active
├── models/User.js                # Schema with maxDevices, singleActiveSession, etc.
├── routes/                       # Express routes for Auth, Admin, and User
├── utils/generators.js           # Password and License Key generators
└── index.js                      # Express App Entry
```

## Deployment Guide

### Option 1: Render.com
1. Create a new **Web Service** on Render.
2. Connect your GitHub repository.
3. Configure the following:
   - **Build Command**: `npm install`
   - **Start Command**: `node api/index.js`
4. Add Environment Variables in the Render Dashboard:
   - `MONGO_URI`: Your MongoDB connection string.
   - `JWT_SECRET`: A secure random string.
   - `NODE_ENV`: `production`
5. Click **Deploy**.

### Option 2: Oracle Cloud Infrastructure (Free Tier VM)
1. Provision an **Always Free Compute Instance** (e.g., Ubuntu 22.04).
2. SSH into the instance and install Node.js & PM2:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   sudo npm install -g pm2
   ```
3. Clone your repository:
   ```bash
   git clone <your-repo-url>
   cd Svg-Convertor
   npm install
   ```
4. Create an `.env` file:
   ```bash
   nano .env
   # Add MONGO_URI, JWT_SECRET, PORT=80
   ```
5. Start the server using PM2 (you may need `sudo` to bind to port 80, or configure Nginx as a reverse proxy):
   ```bash
   pm2 start api/index.js --name aura-api
   pm2 startup
   pm2 save
   ```
6. Open port 80/443 in the Oracle Cloud VCN Security Lists.

## API Endpoints Documentation

### Public Authentication API
**1. Login User** `POST /api/auth/login`
- **Body:** `{ "email": "...", "password": "...", "machineId": "device-uuid", "deviceName": "Desktop", "platform": "Windows", "osVersion": "11", "machineName": "DESKTOP-123" }`
- **Response:** JWT Token, User info. Registers device if under limit.

**2. Check License** `POST /api/license/check` (Protected)
- **Body:** `{ "machineId": "device-uuid" }`
- **Response:** License validity status.

### User API (Protected)
**1. Register Device** `POST /api/device/register`
- **Body:** `{ "deviceId": "...", "deviceName": "..." }`

**2. Subscription Status** `POST /api/subscription/status`
- **Response:** `{ "subscriptionStatus": "active", "expiresAt": "...", "active": true }`

### Admin API (Protected, Admin Only)
Requires Header: `Authorization: Bearer <admin_token>`

**1. Create User** `POST /api/admin/create-user`
- **Body:** `{ "name": "...", "email": "...", "maxDevices": 2, "singleActiveSession": false }`
- **Response:** Generates random password and License Key automatically.

**2. Activate Subscription** `POST /api/admin/activate-subscription`
- **Body:** `{ "userId": "..." }`

**3. Extend Subscription** `POST /api/admin/extend-subscription`
- **Body:** `{ "userId": "...", "daysToAdd": 30 }`

**4. Deactivate Subscription** `POST /api/admin/deactivate-subscription`
- **Body:** `{ "userId": "..." }`

**5. Reset Password** `POST /api/admin/reset-password`
- **Body:** `{ "userId": "..." }` (Returns newly generated password)

**6. Reset All Devices** `POST /api/admin/reset-devices`
- **Body:** `{ "userId": "..." }`

**7. Delete Single Device** `POST /api/admin/delete-device`
- **Body:** `{ "userId": "...", "deviceId": "..." }`

**8. Change Device Limit** `POST /api/admin/change-device-limit`
- **Body:** `{ "userId": "...", "limit": 3 }`

**9. Delete User** `DELETE /api/admin/delete-user`
- **Body:** `{ "userId": "..." }`

**10. Get Users** `GET /api/admin/users?search=query`
**11. Get User by ID** `GET /api/admin/user/:id`
**12. Dashboard Stats** `GET /api/admin/dashboard`
