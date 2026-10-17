# CareBeacon — Fall Detection & Caregiver Dashboard

## About the Project
CareBeacon is a real-time fall detection monitoring system that connects an ESP32-based wearable device to a web dashboard. It acts as a safety net for elderly patients by tracking their status and instantly alerting their families or medical staff in the event of a fall.

### What the System Does
- Provides real-time fall detection and instant push notification alerts.
- Tracks the live GPS location of the wearer on an interactive map.
- Monitors device health (battery level, connection status).
- Logs a chronological history of fall events and device interactions.
- Enables multi-caregiver scheduling, and emergency contact management (alerts are sent by SMS).

### Who Uses It
- **Elderly Individuals / Patients:** Wear the ESP32-based hardware device for continuous safety monitoring.
- **Caregivers & Family Members:** Use the web dashboard to monitor their loved one's location, coordinate care schedules, and receive emergency alerts.
- **System Administrators:** Manage devices, families, and monitor overall system health via an admin panel.

### My Role
- **Full Stack Developer**: Developed the React/TypeScript frontend dashboard, integrated Firebase for real-time data sync, authentication, and push notifications, and implemented the hardware-to-cloud communication specification for the ESP32 wearable.

---

## Table of Contents

- [Features](#features)
- [Tools and Languages Used](#tools-and-languages-used)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Firebase Setup (Connect Your Own Account)](#firebase-setup-connect-your-own-account)
  - [Step 1: Create a Firebase Project](#step-1-create-a-firebase-project)
  - [Step 2: Enable Authentication](#step-2-enable-authentication)
  - [Step 3: Create a Realtime Database](#step-3-create-a-realtime-database)
  - [Step 4: Apply Security Rules](#step-4-apply-security-rules)
  - [Step 5: Get Your Firebase Config Keys](#step-5-get-your-firebase-config-keys)
  - [Step 6: Set Up Cloud Messaging (Push Notifications)](#step-6-set-up-cloud-messaging-push-notifications)
  - [Step 7: Update the Service Worker](#step-7-update-the-service-worker)
  - [Step 8: Create an Admin Account](#step-8-create-an-admin-account)
- [EmailJS Setup (Optional — Join Request Notifications)](#emailjs-setup-optional--join-request-notifications)
- [Deployment](#deployment)
  - [Vercel (Recommended)](#vercel-recommended)
  - [Other Platforms](#other-platforms)
- [Project Structure](#project-structure)
- [Hardware Integration](#hardware-integration)
- [Database Structure](#database-structure)
- [License](#license)

---

## Features

- **Real-time Fall Detection Alerts** — Receive instant push notifications when a fall is detected.
- **Live Location Tracking** — Monitor the location of the elderly user on an interactive map.
- **Device Status Monitoring** — Track battery level, connection status, and last heartbeat.
- **Fall History Timeline** — View a chronological log of all detected events.
- **Emergency Contact Management** — Add, edit, and manage emergency contacts.
- **Caregiver Scheduling** — Coordinate care shifts between family members.
- **Caregiver Analytics** — View activity summaries and response times.
- **Multi-Caregiver Support** — Multiple caregivers can link to the same device with an approval workflow.
- **Admin Dashboard** — Full admin panel for managing devices, families, incidents, and system settings.
- **Push Notifications (FCM)** — Browser-based push notifications via Firebase Cloud Messaging.

---

## Tools and Languages Used

| Category    | Technology                                         |
|-------------|----------------------------------------------------|
| Languages   | TypeScript, HTML, CSS, JavaScript                  |
| Frontend    | React 18, Vite                                     |
| Styling     | Tailwind CSS 4, shadcn/ui (Radix primitives)       |
| Backend     | Firebase (Authentication, Realtime Database, FCM)  |
| Maps        | Leaflet / React-Leaflet                            |
| Charts      | Recharts                                           |
| Deployment  | Vercel (pre-configured)                            |
| Hardware    | ESP32 with SIM7670G/SIM800L module                 |

---

## Prerequisites

- **Node.js** ≥ 18 (LTS recommended)
- **npm** (comes with Node.js)
- A **Firebase account** — [https://firebase.google.com/](https://firebase.google.com/)
- A **Vercel account** (for deployment) — [https://vercel.com/](https://vercel.com/)

---

## Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Dezh-69/CareBeacon.git
   cd CareBeacon
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create your environment file:**
   ```bash
   cp .env.example .env
   ```
   Then fill in the `.env` file with your Firebase credentials (see the next section).

4. **Start the development server:**
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:5173`.

---

## Firebase Setup (Connect Your Own Account)

This project uses Firebase for authentication, database, and push notifications. Follow these steps to connect your own Firebase project.

### Step 1: Create a Firebase Project

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **"Add project"** (or "Create a project").
3. Enter a project name (e.g., `CareBeacon`).
4. (Optional) Enable Google Analytics if desired.
5. Click **"Create project"** and wait for it to be ready.

### Step 2: Enable Authentication

1. In your Firebase project, go to **Build → Authentication** in the left sidebar.
2. Click **"Get started"**.
3. Go to the **"Sign-in method"** tab.
4. Enable **"Email/Password"** as a sign-in provider. Click the toggle, then **Save**.

### Step 3: Create a Realtime Database

1. In the left sidebar, go to **Build → Realtime Database**.
2. Click **"Create Database"**.
3. Choose a database location closest to your users:
   - For Philippines/Southeast Asia: **`asia-southeast1` (Singapore)**
4. Select **"Start in locked mode"** (we'll apply custom rules next).
5. Click **"Enable"**.

> **Important:** Note the full database URL displayed (e.g., `https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app`). You'll need this for the `.env` file.

### Step 4: Apply Security Rules

1. In the Realtime Database section, go to the **"Rules"** tab.
2. Replace the default rules with the contents of the [`database.rules.json`](database.rules.json) file included in this repository.
3. Click **"Publish"**.

The provided rules enforce:
- Users can only read/write their own profile data.
- Caregivers can only access families they belong to (and only if their status is `active`).
- Pending caregivers can submit join requests but cannot read family data.
- Admin nodes are restricted to users with `role: "admin"`.

### Step 5: Get Your Firebase Config Keys

1. In the Firebase Console, click the **⚙️ gear icon** next to "Project Overview" → **Project settings**.
2. Scroll down to **"Your apps"** section.
3. If you haven't added a web app yet, click the **web icon `</>`** to register one:
   - Enter an app nickname (e.g., `CareBeacon Web`).
   - **Do NOT** check "Also set up Firebase Hosting" (we use Vercel).
   - Click **"Register app"**.
4. Firebase will display your config object. Copy the values and paste them into your `.env` file:

```env
VITE_FIREBASE_API_KEY=your_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_VAPID_KEY=your_vapid_key_here
```

> **Note:** The `VITE_FIREBASE_VAPID_KEY` is set up in the next step.

### Step 6: Set Up Cloud Messaging (Push Notifications)

Push notifications alert caregivers when a fall is detected, even if the browser tab isn't active.

1. In Firebase Console → **Project Settings → Cloud Messaging** tab.
2. Under **"Web configuration"**, find the **"Web Push certificates"** section.
3. Click **"Generate key pair"**. This generates a VAPID key.
4. Copy the generated key and add it to your `.env` file:
   ```
   VITE_FIREBASE_VAPID_KEY=your_generated_vapid_key
   ```

### Step 7: Update the Service Worker

The file `public/firebase-messaging-sw.js` handles background push notifications. **You must update the hardcoded Firebase config in this file** to match your own project:

1. Open [`public/firebase-messaging-sw.js`](public/firebase-messaging-sw.js).
2. Replace the `firebaseConfig` object with your own values:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

> **Why is this separate?** Service workers cannot access environment variables (`import.meta.env`), so the Firebase config must be hardcoded in this file.

### Step 8: Create an Admin Account

The admin dashboard is accessible at `/admin` and is restricted to users with `role: "admin"` in the database.

1. First, create a regular account via the Sign Up form in the app.
2. Go to your **Firebase Console → Realtime Database**.
3. Navigate to `users/{your-user-uid}`.
4. Add or change the `role` field to `"admin"`:
   ```json
   {
     "name": "Admin Name",
     "email": "admin@example.com",
     "role": "admin",
     "accessStatus": "active"
   }
   ```
5. Sign out and sign back in. You will be redirected to the admin dashboard automatically.

---

## EmailJS Setup (Optional — Join Request Notifications)

When a new caregiver requests to join an existing family, the app can send an email notification to the existing caregivers using [EmailJS](https://www.emailjs.com/) (free tier: 200 emails/month).

1. Create a free account at [https://www.emailjs.com/](https://www.emailjs.com/).
2. Set up an **Email Service** (e.g., connect your Gmail).
3. Create an **Email Template** with these template variables:
   - `{{new_user_name}}` — Name of the person requesting to join.
   - `{{device_serial}}` — Serial number of the CareBeacon device.
4. Get your **Service ID**, **Template ID**, and **Public Key** from the EmailJS dashboard.
5. Open [`src/lib/email.ts`](src/lib/email.ts) and replace the placeholder values:
   ```ts
   const serviceId = 'YOUR_EMAILJS_SERVICE_ID';
   const templateId = 'YOUR_EMAILJS_TEMPLATE_ID';
   const publicKey = 'YOUR_EMAILJS_PUBLIC_KEY';
   ```

> **Note:** This step is optional. If left unconfigured, the app will log a message to the console instead of sending an email.

---

## Deployment

### Vercel (Recommended)

The project includes a pre-configured [`vercel.json`](vercel.json) for SPA routing.

1. Push your code to GitHub.
2. Go to [vercel.com](https://vercel.com/) and import the repository.
3. In the Vercel project settings, add all the **environment variables** from your `.env` file:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_DATABASE_URL`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_FIREBASE_VAPID_KEY`
4. Deploy. Vercel will build and serve the app automatically.

> **Important:** After deploying, add your Vercel domain (e.g., `carebeacon.vercel.app`) to your Firebase project's **Authorized Domains**:
> Firebase Console → Authentication → Settings → Authorized domains → Add domain.

### Other Platforms

For any static hosting platform (Netlify, Cloudflare Pages, etc.):

1. Run the production build:
   ```bash
   npm run build
   ```
2. Upload the contents of the `dist/` folder to your hosting provider.
3. Configure URL rewrites so that all routes serve `index.html` (SPA mode).

---

## Project Structure

```
CareBeacon/
├── public/
│   └── firebase-messaging-sw.js   # FCM service worker (update config here)
├── src/
│   ├── app/
│   │   ├── App.tsx                 # Root app with routing & auth state
│   │   └── components/
│   │       ├── Dashboard.tsx       # Main caregiver dashboard
│   │       ├── Login.tsx           # Login / Sign-up form
│   │       ├── LocationMap.tsx     # Leaflet map for location tracking
│   │       ├── DeviceStatus.tsx    # Device battery & connection status
│   │       ├── FallHistory.tsx     # Fall event history timeline
│   │       ├── EmergencyContacts.tsx
│   │       ├── CaregiverSchedule.tsx
│   │       ├── CaregiverAnalytics.tsx
│   │       ├── JoinRequests.tsx    # Approve/reject new caregivers
│   │       ├── admin/              # Admin panel components
│   │       │   ├── AdminDashboard.tsx
│   │       │   ├── AdminDevices.tsx
│   │       │   ├── AdminFamilies.tsx
│   │       │   ├── AdminIncidents.tsx
│   │       │   ├── AdminReview.tsx
│   │       │   └── ...
│   │       └── ui/                 # shadcn/ui primitives
│   ├── lib/
│   │   ├── firebase.ts            # Firebase initialization (reads .env)
│   │   ├── db.ts                  # Realtime Database helper functions
│   │   ├── messaging.ts           # FCM push notification helpers
│   │   └── email.ts               # EmailJS integration (optional)
│   └── styles/                    # Global CSS & Tailwind config
├── hardware/
│   └── firmware/                  # ESP32 firmware (separate from web app)
├── database.rules.json            # Firebase Realtime Database security rules
├── hardware_spec.md               # ESP32 → Firebase payload specification
├── .env.example                   # Template for environment variables
├── vercel.json                    # Vercel SPA rewrite config
├── vite.config.ts                 # Vite build configuration
└── package.json
```

---

## Hardware Integration

The ESP32 device communicates with the web dashboard through Firebase Realtime Database. See [`hardware_spec.md`](hardware_spec.md) for the complete specification of JSON payloads the device must send, including:

- **Device heartbeat** — Status, battery, location updates
- **Fall events** — Creating emergency event records
- **Alert delivery receipts** — SMS delivery tracking
- **FCM push notifications** — Sending alerts directly from the device

---

## Database Structure

```
├── admin/
│   ├── inventory/{serialNumber}     # Provisioned devices
│   └── registrationQueue/{id}       # Pending registration reviews
├── users/{uid}/
│   ├── name, email, phone, role
│   ├── familyId
│   └── accessStatus                 # "active" | "pending" | "suspended"
├── families/{familyId}/
│   ├── monitoredPerson/name
│   ├── deviceSerialNumber
│   ├── caregivers/{uid}
│   └── joinRequests/{requestId}
├── devices/{deviceId}/
│   ├── status, battery, lastUpdate
│   ├── location/{lat, lng}
│   ├── familyId
│   └── fcmTokens/{uid}             # Push notification tokens
└── events/{deviceId}/{eventId}/
    ├── timestamp, status, location
    └── receipts[]                   # SMS delivery receipts
```

---

## License

This project includes components from [shadcn/ui](https://ui.shadcn.com/) (MIT License) and photos from [Unsplash](https://unsplash.com).