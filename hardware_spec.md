# CareBeacon ESP32 Hardware Integration Spec

This document outlines the JSON payloads the ESP32 hardware must send to Firebase Realtime Database.

## 1. Device Status Updates (Heartbeat)
The ESP32 should periodically update its connection status and battery level.

**Path:** `devices/{deviceId}`
**Method:** `PATCH` or `PUT`

```json
{
  "status": "online",
  "battery": 85.5,
  "lastUpdate": "2024-03-20T10:30:00Z",
  "location": {
    "lat": 1.3521,
    "lng": 103.8198
  }
}
```

## 2. Emergency Events (Falls & SOS)
When a fall is detected or the SOS button is pressed, the ESP32 must create a new event.

**Path:** `events/{deviceId}/{eventId}`
**Method:** `PUT`

```json
{
  "timestamp": "2024-03-20T14:22:00Z",
  "status": "pending", // Can be 'pending', 'confirmed', 'resolved', 'cancelled', 'emergency'
  "location": "Kitchen",
  "contactNotified": "None",
  "receipts": [] // Empty array initially
}
```

## 3. Alert Delivery Receipts
(The system sends SMS alerts only. Phone calls are not used, so no call receipts are recorded.)

After the SIM7670G/SIM7672 module finishes texting the emergency contacts, it must update the event with the delivery status so the Admin Dashboard can track it.

**Path:** `events/{deviceId}/{eventId}/receipts`
**Method:** `PUT` or Array append

```json
[
  {
    "method": "SMS",
    "contactName": "Maria Santos",
    "timestamp": "2024-03-20T14:22:05Z",
    "status": "Delivered" // or "Failed"
  }
]
```

## 4. Sending Push Notifications (FCM)
To avoid needing a paid Firebase backend, the ESP32 can trigger push notifications directly via the Firebase Cloud Messaging (FCM) Legacy HTTP API.

### Step A: Fetch Caregiver Tokens
The web app saves all registered caregiver push tokens under a single node for your device:
**Path:** `devices/{deviceId}/fcmTokens`

When a fall occurs, perform a `GET` request to this path. It will return a JSON object where the values are the FCM tokens:
```json
{
  "userUid1": "fwR3...tokenString",
  "userUid2": "dK8j...tokenString"
}
```

### Step B: Send the HTTP POST Request
For each token (or you can send to multiple at once if you format it as a `registration_ids` array), make an HTTP POST request to Google's FCM servers.

**Endpoint:** `POST https://fcm.googleapis.com/fcm/send`
**Headers:**
- `Content-Type: application/json`
- `Authorization: key=YOUR_FIREBASE_SERVER_KEY` (Get this from Firebase Console > Project Settings > Cloud Messaging > Cloud Messaging API (Legacy))

**JSON Body:**
```json
{
  "to": "fwR3...tokenString",
  "notification": {
    "title": "EMERGENCY: Fall Detected!",
    "body": "Maria Santos has experienced a fall in the Kitchen.",
    "sound": "default"
  },
  "data": {
    "click_action": "FLUTTER_NOTIFICATION_CLICK",
    "deviceId": "ESP32_001"
  }
}
```
