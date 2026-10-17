#include <Arduino.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <time.h>
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>

#include <Firebase_ESP_Client.h>
#include <addons/TokenHelper.h>


// ============================================================
// WIFI CONFIGURATION
// ============================================================

// [CHANGED] WiFi is NO LONGER hard-coded.
// The family sets it WITHOUT touching the code, in either of two ways:
//   1) SMS: a registered contact texts the hub's SIM number:
//          WIFI MyWifiName;MyPassword
//   2) Setup page: when the hub has no WiFi it opens its own hotspot
//          "CareBeacon-Setup-XXXX" (password below). Join it with a phone and
//          the setup page opens (or go to http://192.168.4.1).
// The hub remembers up to 3 networks (in flash) and works WITHOUT WiFi too
// (buzzer, SMS, call). WiFi is only needed for the website.
// 2.4 GHz only.
//
// DEFAULT_SSID / DEFAULT_PASS are only a first-time starting point
// (leave "" for none).
const char *DEFAULT_SSID = "WhyPie_EXT";
const char *DEFAULT_PASS = "Ilovemykids041118";

// Setup hotspot
#define PORTAL_PASS "carebeacon"


// ============================================================
// FIREBASE CONFIGURATION
// ============================================================

#define API_KEY \
  "AIzaSyBtHKQT_R6rWLW2oN5OLt0CQOKkSlDnQN8"

#define DATABASE_URL \
  "https://clone-91070-default-rtdb.asia-southeast1.firebasedatabase.app"

#define FIREBASE_USER_EMAIL \
  "manuelsantiagoo343@gmail.com"

#define FIREBASE_USER_PASSWORD \
  "123456"

#define DEVICE_ID \
  "CB-MOCK-0009"


// ============================================================
// FALLBACK EMERGENCY NUMBER
// Only used until the hub has downloaded the contacts registered on the
// website (Emergency Contacts page). After that the website list is used.
// ============================================================

#define EMERGENCY_PHONE \
  "+639074997791"


// ============================================================
// GPS
// ============================================================

// GPS TX -> ESP32-C3 GPIO20
#define GPS_RX 20

// ESP32 GPIO21 -> GPS RX
#define GPS_TX 21


// ============================================================
// SIM800L
// ============================================================

// SIM800L TxD -> ESP32 GPIO2 (tested)
// SIM800L RxD -> ESP32 GPIO9 (tested)

#define SIM800_RX 2
#define SIM800_TX 9


// ============================================================
// BUZZER
// ============================================================

#define BUZZER_PIN 7

// Loudest frequency for this buzzer (found with buzzer_test.ino)
#define BUZZER_FREQ 2550


// ============================================================
// ESP-NOW MESSAGE TYPES
// ============================================================

#define MSG_HEARTBEAT  0
#define MSG_SOS        1
#define MSG_FALL       2
#define MSG_CANCEL     3
#define MSG_SILENCE    4   // [NEW] hold CANCEL 2 s on the wrist = QUIET STOP (no SMS, no call)

// WEARABLE ESP32 MAC ADDRESS
uint8_t wearableMAC[] = {
  0x58, 0x8C, 0x81, 0xA5, 0x0B, 0xD4
};


// ============================================================
// ESP-NOW MESSAGE STRUCTURE
// ============================================================

typedef struct {

  uint8_t messageType;

  float accelerationG;

  bool sosPressed;

  bool cancelPressed;

  unsigned long timestamp;

} CareBeaconMessage;


// ============================================================
// OBJECTS
// ============================================================

TinyGPSPlus gps;

HardwareSerial GPS(0);      // UART0 - tested working with GPS on GPIO20

HardwareSerial SIM800(1);   // UART1 - tested working with SIM800L on GPIO2/9

FirebaseData fbdo;

FirebaseAuth auth;

FirebaseConfig config;


// ============================================================
// SYSTEM VARIABLES
// ============================================================

bool gpsActive = false;

bool buzzerActive = false;

volatile bool sosActive = false;      // [CHANGED] volatile: read by the buzzer task

volatile bool fallSuspected = false;

bool sim800Active = false;

bool firebaseActive = false;

bool wearableConnected = false;

volatile bool pendingMessage = false;      // set by ESP-NOW callback
volatile uint8_t pendingMessageType = 0;

// [NEW] set the moment a CANCEL arrives from the wearable, so every
// waiting step (Firebase, SMS, call) can react right away
volatile bool cancelRequested = false;

// [NEW] QUIET STOP: like CANCEL (alarm off, SMS / call stopped or skipped)
// but WITHOUT the "I'm OK" SMS
volatile bool quietStop = false;


// ============================================================
// WEARABLE DATA
// ============================================================

float wearableAcceleration = 1.0;

unsigned long lastWearableMessage = 0;

const unsigned long WEARABLE_TIMEOUT = 35000;   // wrist heartbeat every 10 s


// ============================================================
// BUZZER
// ============================================================

unsigned long lastBuzzerTime = 0;

bool buzzerState = false;


// ============================================================
// FIREBASE
// ============================================================

unsigned long lastFirebaseUpdate = 0;

const unsigned long FIREBASE_INTERVAL = 10000;


// ============================================================
// SIM800
// ============================================================

const unsigned long CALL_DURATION = 30000;

const unsigned long SMS_TIMEOUT = 15000;

// How often to ask the SIM800L "is the call answered yet?" (AT+CLCC)
const unsigned long CLCC_INTERVAL = 1500;


// ============================================================
// [NEW] DELIVERY TRACKING (for the website's Alert Delivery page)
// ============================================================

// Firebase key of the alert that is being sent right now,
// e.g. events/CB-MOCK-0009/<this key>
String currentEventKey = "";

// SMS reference number from "+CMGS: <ref>" and the alert it belongs to.
// Used to match the delivery report (+CDS) that arrives later.
String lastSmsEventKey = "";

// Line buffer for messages coming from the SIM800L
String sim800Line = "";

// [NEW] last alert, so a CANCEL can mark it and text "I'm OK"
String lastAlertKey     = "";
bool   lastAlertSmsSent = false;

// [NEW] OFFLINE MODE ("offline memory")
// Alerts made while there is no WiFi are kept here (key "offline:N")
// AND saved in the hub's flash memory, so they survive a restart /
// battery swap. When WiFi is back they are uploaded to the website
// with the time they really happened.
Preferences offlineStore;
uint32_t bootId = 0;           // counts restarts (to know if millis() is still valid)
bool firebaseStarted = false;  // Firebase starts only after the first WiFi connection

// [NEW] LAST KNOWN LOCATION
// Remembered (also in flash) so an alert still has a location when the
// GPS has no fix right now (indoors, just restarted, etc.)
bool   haveLastFix = false;
double lastFixLat = 0, lastFixLng = 0;
unsigned long lastFixMillis = 0;     // when (this power-on), 0 = before restart
uint32_t lastFixEpoch = 0;           // real time of that fix if known
unsigned long lastFixSaved = 0;      // last time it was written to flash

struct OfflineEvent {
  bool   used;
  String status, type;
  unsigned long atMillis;
  uint32_t epoch;              // real time (s since 1970) if known, else 0
  uint32_t boot;               // bootId when it happened
  float  acc;
  bool   hasLoc;
  double lat, lng;
  String smsCodes, smsResp, callCodes, callResp, phones;   // one status letter per contact
  bool   cancelled;
};
const int OFFLINE_MAX = 10;
OfflineEvent offlineEvents[OFFLINE_MAX];

// background WiFi manager
bool wifiWasConnected = false;
bool wifiTrying = false;
int  wifiIndex = 0;
unsigned long wifiTryStart = 0;
unsigned long wifiLastTry = 0;
const unsigned long WIFI_TRY_MS   = 12000;   // give each network 12 s
const unsigned long WIFI_RETRY_MS = 60000;   // wait 60 s between tries
const uint8_t OFFLINE_CHANNEL = 1;           // radio channel while offline

// [NEW] true = when an alert is cancelled after its SMS was sent,
//       send a second SMS saying the person pressed CANCEL (is OK)
const bool SEND_CANCEL_SMS = true;

// ============================================================
// [NEW] EMERGENCY CONTACTS (downloaded from the website)
// ============================================================
// The website saves them at families/<familyId>/contacts and the hub reads
// them (and keeps a copy in flash so alerts still work without WiFi).
#define MAX_CONTACTS 10     // everybody on this list gets the SMS
#define MAX_CALLS    3      // the hub calls in order until someone answers (max this many)

struct Contact {
  String name;
  String phone;     // +639XXXXXXXXX
};

Contact contacts[MAX_CONTACTS];
int contactCount = 0;
bool contactsLoadedOnce = false;          // true once the list was read from the website / flash

Contact alertContacts[MAX_CONTACTS];      // snapshot used by the alert being sent
int alertContactCount = 0;

int    currentContact = 0;                // contact being texted / called right now
String currentPhone = "";

int smsRefs[MAX_CONTACTS] = { -1, -1, -1, -1, -1, -1, -1, -1, -1, -1 };   // SMS reference per contact
uint16_t lastAlertSmsMask = 0;            // bit n = contact n got the alert SMS

unsigned long lastContactRefresh = 0;
const unsigned long CONTACT_REFRESH_MS = 60000;

// ---- saved WiFi networks ----
#define MAX_NETS 3
String netSsid[MAX_NETS];
String netPass[MAX_NETS];
int netCount = 0;

// ---- setup hotspot ----
WebServer portalServer(80);
DNSServer dnsServer;
bool portalOn = false;
bool portalEverClosed = false;
unsigned long portalStart = 0;
unsigned long portalClosedAt = 0;
const unsigned long PORTAL_MAX_MS = 600000;     // hotspot stays open 10 min
const unsigned long PORTAL_COOLDOWN_MS = 300000;

// ---- incoming SMS commands ----
int pendingSmsIdx = 0;


// Call state, filled in by handleSIM800Line()
bool callAnswered = false;
bool callEnded    = false;
String callEndReason = "";


// ============================================================
// STARTUP
// ============================================================

unsigned long startupTime = 0;


void handleWearableSOS();
void handleWearableFall();
void handleWearableCancel();
void wifiManager();
void flushOfflineEvents();
void saveOfflineEvent(int i);
void loadOfflineEvents();
uint32_t nowEpoch();
bool getAlertLocation(double &lat, double &lng, String &note);
void trackLastFix();
void initializeFirebase();
int  offlineIndex(String key);
void sendCancelSMS();
bool firebaseReady();
String sendEmergencyEvent(String eventStatus, String eventType);
void writeDelivery(String eventKey, String channel, String status, String response);
void pollSIM800();
void sendDeviceStatus();
void writeDeliveryFor(String eventKey, int idx, String channel, String status, String response);
void snapshotContacts();
void saveContacts();
void loadContacts();
bool refreshContacts();
void contactsManager();
void loadNetworks();
void saveNetwork(String ssid, String pass);
void startPortal();
void stopPortal();
void portalManager();
void portalLoop();
void processIncomingSMS();
bool sendTextSMS(String phone, String text);
char statusToCode(String st);
String codeToStatus(char c);
String clean(String v);
String field(const String &s, int n);
void printGPSLocation();
void buzzerON();
void buzzerOFF();
void processBuzzer();

// ============================================================
// ESP-NOW RECEIVE CALLBACK
// ============================================================

void onDataRecv(
  const esp_now_recv_info_t *info,
  const uint8_t *incomingData,
  int len
) {

  if (
    len != sizeof(CareBeaconMessage)
  ) {

    Serial.println(
      "[ESP-NOW] Invalid message size"
    );

    return;
  }


  CareBeaconMessage incoming;


  memcpy(
    &incoming,
    incomingData,
    sizeof(incoming)
  );


  lastWearableMessage =
    millis();


  wearableConnected =
    true;


  wearableAcceleration =
    incoming.accelerationG;


  Serial.println();

  Serial.println(
    "================================"
  );

  Serial.println(
    "ESP-NOW MESSAGE RECEIVED"
  );

  Serial.println(
    "================================"
  );


  Serial.print(
    "Message type: "
  );

  Serial.println(
    incoming.messageType
  );


  Serial.print(
    "Acceleration: "
  );

  Serial.print(
    incoming.accelerationG,
    2
  );

  Serial.println(
    " G"
  );


  // Heavy work (SMS, call, Firebase) is NOT done here - this runs inside
  // the WiFi task and would freeze/crash the hub. loop() handles it.
  // [NEW] QUIET STOP = a cancel without the "I'm OK" SMS
  if (incoming.messageType == MSG_SILENCE) {
    quietStop = true;
    cancelRequested = true;          // stops the buzzer, SMS and call right away
    pendingMessageType = MSG_CANCEL; // loop() finishes it like a cancel
    pendingMessage = true;
    Serial.println("[WEARABLE] QUIET STOP (alarm off, no SMS, no call)");
    return;
  }

  if (incoming.messageType != MSG_HEARTBEAT) {
    // [NEW] cancel flag: set on CANCEL, cleared by a new SOS / FALL
    cancelRequested = (incoming.messageType == MSG_CANCEL);
    if (incoming.messageType == MSG_CANCEL) quietStop = false;   // short press = normal cancel
    pendingMessageType = incoming.messageType;
    pendingMessage = true;
  }

  switch (
    incoming.messageType
  ) {

    case MSG_HEARTBEAT:

      Serial.println(
        "[WEARABLE] HEARTBEAT"
      );

      break;


    case MSG_SOS:

      Serial.println(
        "[WEARABLE] SOS ACTIVATED"
      );


      // handled in loop()
      break;


    case MSG_FALL:

      Serial.println(
        "[WEARABLE] FALL CONFIRMED"
      );


      // handled in loop()
      break;


    case MSG_CANCEL:

      Serial.println(
        "[WEARABLE] CANCEL RECEIVED"
      );


      // handled in loop()
      break;


    default:

      Serial.println(
        "[ESP-NOW] Unknown message"
      );

      break;
  }
}


// ============================================================
// INITIALIZE ESP-NOW
// ============================================================

void initializeESPNow() {

  Serial.println();

  Serial.println(
    "================================"
  );

  Serial.println(
    "INITIALIZING ESP-NOW"
  );

  Serial.println(
    "================================"
  );


  // WiFi already needs to be initialized
  // for ESP-NOW + Firebase operation.

  if (
    esp_now_init() != ESP_OK
  ) {

    Serial.println(
      "[ERROR] ESP-NOW initialization failed"
    );

    return;
  }


  esp_now_register_recv_cb(
    onDataRecv
  );


  Serial.println(
    "[OK] ESP-NOW receiver ready"
  );


  Serial.print(
    "Central Hub MAC: "
  );


  Serial.println(
    WiFi.macAddress()
  );
}


// ============================================================
// SIM800 BUFFER
// ============================================================

void clearSIM800Buffer() {

  while (
    SIM800.available()
  ) {

    SIM800.read();
  }
}


// ============================================================
// [NEW] KEEP THE ALARM RESPONSIVE WHILE WAITING
// ============================================================
// Called inside every waiting loop (SMS, call). Reads GPS, keeps the
// buzzer pattern going, and silences the buzzer the moment CANCEL arrives.

void keepAlarmAlive() {

  while (GPS.available()) gps.encode(GPS.read());

  trackLastFix();

  if (cancelRequested && sosActive) {

    Serial.println("[CANCEL] received - buzzer OFF");

    sosActive = false;

    fallSuspected = false;

    buzzerOFF();
  }

  processBuzzer();
}


// ============================================================
// SEND SIM800 COMMAND
// ============================================================

bool sendSIM800Command(
  String command,
  String expected,
  unsigned long timeout
) {

  clearSIM800Buffer();


  Serial.print(
    "[SIM800] >> "
  );

  Serial.println(
    command
  );


  SIM800.println(
    command
  );


  unsigned long start =
    millis();


  String response = "";


  while (
    millis() - start <
    timeout
  ) {

    while (
      SIM800.available()
    ) {

      char c =
        SIM800.read();


      response += c;


      Serial.write(c);


      if (
        response.indexOf(
          expected
        ) >= 0
      ) {

        Serial.println();

        return true;
      }
    }
  }


  Serial.println();

  return false;
}


// ============================================================
// INITIALIZE SIM800L
// ============================================================

void initializeSIM800() {

  Serial.println();

  Serial.println(
    "================================"
  );

  Serial.println(
    "INITIALIZING SIM800L"
  );

  Serial.println(
    "================================"
  );


  SIM800.begin(
    9600,
    SERIAL_8N1,
    SIM800_RX,
    SIM800_TX
  );


  delay(3000);


  clearSIM800Buffer();


  if (
    sendSIM800Command(
      "AT",
      "OK",
      3000
    )
  ) {

    Serial.println(
      "[OK] SIM800L responding"
    );

  } else {

    Serial.println(
      "[ERROR] SIM800L not responding"
    );

    sim800Active =
      false;

    return;
  }


  sendSIM800Command(
    "ATE0",
    "OK",
    3000
  );


  if (
    sendSIM800Command(
      "AT+CMGF=1",
      "OK",
      3000
    )
  ) {

    Serial.println(
      "[OK] SMS text mode enabled"
    );
  }


  sendSIM800Command(
    "AT+CPIN?",
    "READY",
    5000
  );


  sendSIM800Command(
    "AT+CREG?",
    "OK",
    3000
  );


  // [NEW] Ask the network for SMS delivery reports.
  // 49 = request a status report for every SMS we send.
  sendSIM800Command(
    "AT+CSMP=49,167,0,0",
    "OK",
    3000
  );


  // [NEW] Show delivery reports on the serial line as "+CDS: ..."
  sendSIM800Command(
    "AT+CNMI=2,1,0,1,0",
    "OK",
    3000
  );


  // [NEW] empty the SIM's message storage so incoming commands always fit
  sendSIM800Command(
    "AT+CMGD=1,4",
    "OK",
    5000
  );


  sim800Active =
    true;


  Serial.println(
    "[OK] SIM800L initialized"
  );
}


// ============================================================
// [NEW] READ MESSAGES THE SIM800L SENDS ON ITS OWN
// ============================================================
// Handles:
//   +CDS: ...      SMS delivery report  -> "delivered" / "failed"
//   +CLCC: ...     call status          -> answered?
//   NO CARRIER / BUSY / NO ANSWER       -> call ended

void handleSIM800Line(
  String line
) {

  line.trim();

  if (line.length() == 0) {
    return;
  }

  Serial.print("[SIM800] << ");
  Serial.println(line);


  // ---------- SMS delivery report ----------
  // Text mode format: +CDS: <fo>,<mr>,"<ra>",<tora>,"<scts>","<dt>",<st>
  // mr = message reference (same number as +CMGS)
  // st = 0 delivered, 1-63 still trying, 64+ failed
  if (line.startsWith("+CDS:")) {

    int firstComma  = line.indexOf(',');
    int secondComma = line.indexOf(',', firstComma + 1);
    int lastComma   = line.lastIndexOf(',');

    if (firstComma < 0 || lastComma <= firstComma) {
      return;
    }

    int ref = line.substring(
      firstComma + 1,
      secondComma > 0 ? secondComma : line.length()
    ).toInt();

    int st = line.substring(lastComma + 1).toInt();

    Serial.print("[SMS] Delivery report ref=");
    Serial.print(ref);
    Serial.print(" st=");
    Serial.println(st);

    // [CHANGED] several contacts get the SMS: find which one this report is for
    if (lastSmsEventKey.length() > 0) {

      for (int ci = 0; ci < MAX_CONTACTS; ci++) {

        if (smsRefs[ci] != ref) continue;

        if (st == 0) {
          writeDeliveryFor(lastSmsEventKey, ci, "sms", "delivered", line);
        } else if (st >= 64) {
          writeDeliveryFor(lastSmsEventKey, ci, "sms", "failed", line);
        }
        // 1-63 = network still trying, keep "sent"

        break;
      }
    }

    return;
  }


  // ---------- [NEW] a text message arrived (WIFI / STATUS / SETUP commands) ----------
  // +CMTI: "SM",<index>
  if (line.startsWith("+CMTI:")) {

    int c = line.lastIndexOf(',');

    if (c >= 0) {
      pendingSmsIdx = line.substring(c + 1).toInt();
    }

    return;
  }


  // ---------- Call status ----------
  // +CLCC: <id>,<dir>,<stat>,<mode>,<mpty>,...
  // stat: 0 active (answered), 2 dialing, 3 ringing, 6 disconnected
  if (line.startsWith("+CLCC:")) {

    int c1 = line.indexOf(',');
    int c2 = line.indexOf(',', c1 + 1);
    int c3 = line.indexOf(',', c2 + 1);

    if (c1 < 0 || c2 < 0 || c3 < 0) {
      return;
    }

    int stat = line.substring(c2 + 1, c3).toInt();

    if (stat == 0 && !callAnswered) {

      callAnswered = true;

      Serial.println("[CALL] Call ANSWERED");
    }

    return;
  }


  // ---------- Call ended ----------
  if (
    line.indexOf("NO CARRIER") >= 0 ||
    line.indexOf("BUSY") >= 0 ||
    line.indexOf("NO ANSWER") >= 0 ||
    line.indexOf("NO DIALTONE") >= 0
  ) {

    callEnded = true;

    callEndReason = line;

    return;
  }
}


// Read everything waiting on the SIM800L line, one line at a time.
// Call this often (loop + while waiting for a call).
void pollSIM800() {

  while (SIM800.available()) {

    char c = SIM800.read();

    if (c == '\n') {

      handleSIM800Line(sim800Line);

      sim800Line = "";

    } else if (c != '\r') {

      sim800Line += c;

      if (sim800Line.length() > 200) {
        sim800Line = "";
      }
    }
  }
}


// ============================================================
// SEND EMERGENCY SMS
// ============================================================
// [CHANGED] Now also records the result in Firebase:
//   "sent"   - SIM800L accepted it (+CMGS)
//   "failed" - ERROR, no ">" prompt, or timeout
// The later "+CDS" report changes "sent" to "delivered" or "failed".

// [NEW] tries the SMS up to 2 times (SIM800L sometimes fails the first one)
bool sendEmergencySMSOnce(String reason);

bool sendEmergencySMS(
  String reason
) {

  // [CHANGED] texts EVERY registered contact (alertContacts[] = snapshot
  // taken when the alert started)

  bool any = false;

  lastAlertSmsMask = 0;

  for (int i = 0; i < MAX_CONTACTS; i++) smsRefs[i] = -1;

  for (int i = 0; i < alertContactCount; i++) {

    currentContact = i;
    currentPhone = alertContacts[i].phone;

    Serial.printf("[SMS] contact %d/%d: %s (%s)\n", i + 1, alertContactCount,
                  alertContacts[i].name.c_str(), currentPhone.c_str());

    bool ok = false;

    for (int attempt = 1; attempt <= 2 && !ok; attempt++) {

      Serial.printf("[SMS] attempt %d\n", attempt);

      ok = sendEmergencySMSOnce(reason);

      if (ok || cancelRequested || !sim800Active) {
        break;
      }

      // give the SIM800L a moment, make sure it is in text mode again
      for (int w = 0; w < 200; w++) { keepAlarmAlive(); delay(10); }

      sendSIM800Command("AT+CMGF=1", "OK", 2000);
    }

    if (ok) {
      any = true;
      lastAlertSmsMask |= (uint16_t)(1u << i);
    }

    // short pause between messages
    for (int w = 0; w < 30; w++) { keepAlarmAlive(); delay(10); }
  }

  if (alertContactCount == 0) {
    Serial.println("[SMS] no contacts registered - nobody to text");
  }

  currentContact = 0;

  return any;
}


bool sendEmergencySMSOnce(
  String reason
) {

  String eventKey =
    currentEventKey;


  if (!sim800Active) {

    Serial.println(
      "[SMS] SIM800L not active"
    );

    writeDelivery(eventKey, "sms", "failed", "SIM800L not active");

    return false;
  }


  // [NEW] cancelled before the SMS went out -> don't send it
  if (cancelRequested) {

    Serial.println("[SMS] skipped - alert was cancelled");

    writeDelivery(eventKey, "sms", "cancelled", "Not sent - alert cancelled on the wearable");

    return false;
  }


  Serial.println();

  Serial.println(
    "=============================="
  );

  Serial.println(
    "[SMS] SENDING EMERGENCY SMS"
  );

  Serial.println(
    "=============================="
  );


  // [CHANGED] new message text, and NO web link:
  // Globe / Smart block SMS that contain links, so the location is sent
  // as plain numbers (paste them into Google Maps). The website shows the map.
  String message =
    "CareBeacon UPDATE\n";


  message +=
    reason;


  message +=
    "\n";


  // [CHANGED] uses the current GPS fix, or the last known location
  double aLat, aLng;
  String aNote;

  if (
    getAlertLocation(aLat, aLng, aNote)
  ) {

    message +=
      aNote.length() ? "Last known location (" + aNote + "): " : String("Location: ");

    message +=
      String(aLat, 6);

    message +=
      ", ";

    message +=
      String(aLng, 6);

    message +=
      "\n(search these numbers in Google Maps)";

  } else {

    message +=
      "Location: not available (no GPS fix yet)";
  }


  message +=
    "\nPlease check on them now.";


  Serial.println(
    message
  );


  clearSIM800Buffer();


  SIM800.println(
    "AT+CMGF=1"
  );


  delay(500);


  SIM800.print(
    "AT+CMGS=\""
  );


  SIM800.print(
    currentPhone
  );


  SIM800.println(
    "\""
  );


  unsigned long start =
    millis();


  bool promptReceived =
    false;


  while (
    millis() - start <
    5000
  ) {

    keepAlarmAlive();   // [NEW]

    if (
      SIM800.available()
    ) {

      char c =
        SIM800.read();


      Serial.write(c);


      if (
        c == '>'
      ) {

        promptReceived =
          true;

        break;
      }
    }
  }


  if (!promptReceived) {

    Serial.println(
      "[SMS] No SMS prompt"
    );

    writeDelivery(eventKey, "sms", "failed", "No SMS prompt from SIM800L");

    return false;
  }


  SIM800.print(
    message
  );


  SIM800.write(
    26
  );


  start =
    millis();


  String response = "";


  while (
    millis() - start <
    SMS_TIMEOUT
  ) {

    keepAlarmAlive();   // [NEW]

    while (
      SIM800.available()
    ) {

      char c =
        SIM800.read();


      response += c;


      Serial.write(c);


      // wait for the full "+CMGS: <ref>" line before reading the number
      int cmgsAt =
        response.indexOf(
          "+CMGS:"
        );

      if (
        cmgsAt >= 0 &&
        response.indexOf('\n', cmgsAt) > 0
      ) {

        Serial.println();

        Serial.println(
          "[SMS] Emergency SMS sent"
        );


        int lineEnd = response.indexOf('\n', cmgsAt);

        String cmgsLine = response.substring(cmgsAt, lineEnd);

        cmgsLine.trim();


        // remember the reference so the +CDS report can be matched
        smsRefs[currentContact] =
          cmgsLine.substring(6).toInt();

        lastSmsEventKey =
          eventKey;


        writeDelivery(eventKey, "sms", "sent", cmgsLine);

        return true;
      }


      if (
        response.indexOf(
          "ERROR"
        ) >= 0
      ) {

        Serial.println();

        Serial.println(
          "[SMS] Sending failed"
        );

        response.trim();

        writeDelivery(eventKey, "sms", "failed", response);

        return false;
      }
    }
  }


  Serial.println(
    "[SMS] Timeout"
  );


  writeDelivery(eventKey, "sms", "failed", "Timeout - no +CMGS from SIM800L");


  return false;
}


// ============================================================
// MAKE PHONE CALL
// ============================================================
// [CHANGED] Now checks whether the call was really answered
// (AT+CLCC) instead of assuming "Call active", and records:
//   "dialing"   - number is being called
//   "answered"  - the contact picked up
//   "no answer" - rang out, rejected, or busy
//   "failed"    - SIM800L error / not active

bool makeEmergencyCall() {

  String eventKey =
    currentEventKey;


  if (!sim800Active) {

    Serial.println(
      "[CALL] SIM800L not active"
    );

    writeDelivery(eventKey, "call", "failed", "SIM800L not active");

    return false;
  }


  Serial.println();

  Serial.println(
    "=============================="
  );

  Serial.println(
    "[CALL] CALLING EMERGENCY CONTACT"
  );

  Serial.println(
    "=============================="
  );


  // [NEW] cancelled before the call -> don't call
  if (cancelRequested) {

    Serial.println("[CALL] skipped - alert was cancelled");

    writeDelivery(eventKey, "call", "cancelled", "Not called - alert cancelled on the wearable");

    return false;
  }


  clearSIM800Buffer();

  sim800Line = "";

  callAnswered = false;

  callEnded = false;

  callEndReason = "";


  SIM800.print(
    "ATD"
  );


  SIM800.print(
    currentPhone
  );


  SIM800.println(
    ";"
  );


  // Wait for the SIM800L to accept the dial command
  unsigned long start =
    millis();

  String response = "";

  bool dialOk = false;


  while (
    millis() - start <
    10000
  ) {

    while (
      SIM800.available()
    ) {

      response += (char)SIM800.read();
    }


    if (response.indexOf("OK") >= 0) {

      dialOk = true;

      break;
    }


    if (
      response.indexOf("ERROR") >= 0 ||
      response.indexOf("NO CARRIER") >= 0 ||
      response.indexOf("BUSY") >= 0 ||
      response.indexOf("NO DIALTONE") >= 0
    ) {

      break;
    }


    keepAlarmAlive();   // [CHANGED] also stops the buzzer on CANCEL
    delay(10);
  }


  response.trim();

  Serial.println(response);


  if (!dialOk) {

    Serial.println(
      "[CALL] Dial failed"
    );


    String status =
      response.indexOf("BUSY") >= 0 ?
      "busy" :
      "failed";


    writeDelivery(eventKey, "call", status, response.length() ? response : String("No reply to ATD"));

    SIM800.println("ATH");

    delay(500);

    return false;
  }


  Serial.println(
    "[CALL] Dialing..."
  );


  // Ring for CALL_DURATION, but hang up right away if CANCEL arrives.
  // Keep the buzzer beeping and GPS reading while we wait.
  // Every CLCC_INTERVAL ask the SIM800L if the call was answered.
  unsigned long callStart =
    millis();

  unsigned long lastClcc =
    0;

  bool answerRecorded =
    false;

  bool cancelled =
    false;


  while (
    millis() - callStart <
    CALL_DURATION
  ) {

    if (
      cancelRequested
    ) {

      Serial.println(
        "[CALL] CANCEL received - hanging up"
      );

      sosActive = false;      // stop the alarm now (loop() finishes the cancel)
      buzzerOFF();
      cancelled = true;
      break;
    }


    if (millis() - lastClcc >= CLCC_INTERVAL) {

      lastClcc = millis();

      SIM800.println("AT+CLCC");
    }


    // reads +CLCC, NO CARRIER, BUSY and any +CDS SMS report
    pollSIM800();


    if (callAnswered && !answerRecorded) {

      answerRecorded = true;

      writeDelivery(eventKey, "call", "answered", "+CLCC stat=0 (active)");
    }


    if (callEnded) {

      Serial.print("[CALL] Call ended by network: ");

      Serial.println(callEndReason);

      break;
    }


    keepAlarmAlive();   // [CHANGED] also stops the buzzer on CANCEL
    delay(10);
  }


  SIM800.println(
    "ATH"
  );


  delay(1000);


  pollSIM800();


  // Final call result (only if it was never answered)
  if (!callAnswered) {

    String status;

    String why;


    if (callEndReason.indexOf("BUSY") >= 0) {

      status = "busy";

      why = callEndReason;

    } else if (cancelled) {

      status = "no answer";

      why = "Alert cancelled on the wearable before the call was answered";

    } else if (callEnded) {

      status = "no answer";

      why = callEndReason;

    } else {

      status = "no answer";

      why = "Not answered within " + String(CALL_DURATION / 1000) + " s";
    }


    writeDelivery(eventKey, "call", status, why);
  }


  Serial.println(
    "[CALL] Call ended"
  );


  return callAnswered;
}


// ============================================================
// EMERGENCY NOTIFICATION
// ============================================================

void sendEmergencyNotification(
  String reason
) {

  Serial.println();

  Serial.println(
    "================================"
  );

  Serial.println(
    "     EMERGENCY NOTIFICATION"
  );

  Serial.println(
    "================================"
  );


  Serial.print(
    "Reason: "
  );

  Serial.println(
    reason
  );


  bool smsSuccess =
    sendEmergencySMS(
      reason
    );


  lastAlertSmsSent =
    smsSuccess;   // [NEW] remembered for the "I'm OK" SMS


  // [CHANGED] call the contacts in order until one answers (max MAX_CALLS tries)
  bool callSuccess = false;

  int callsMade = 0;

  for (int i = 0; i < alertContactCount; i++) {

    currentContact = i;
    currentPhone = alertContacts[i].phone;

    if (cancelRequested) {

      writeDelivery(currentEventKey, "call", "cancelled", "Not called - alert cancelled on the wearable");

    } else if (callSuccess) {

      writeDelivery(currentEventKey, "call", "skipped", "An earlier contact already answered");

    } else if (callsMade >= MAX_CALLS) {

      writeDelivery(currentEventKey, "call", "skipped", "Call limit reached - this contact got the SMS");

    } else {

      callsMade++;

      Serial.printf("[CALL] contact %d/%d: %s (%s)\n", i + 1, alertContactCount,
                    alertContacts[i].name.c_str(), currentPhone.c_str());

      callSuccess = makeEmergencyCall();
    }
  }

  currentContact = 0;


  Serial.println();

  Serial.print(
    "SMS: "
  );

  Serial.println(
    smsSuccess ?
    "SENT" :
    "FAILED"
  );


  Serial.print(
    "CALL: "
  );

  Serial.println(
    callSuccess ?
    "ANSWERED" :
    "NOT ANSWERED / FAILED"
  );
}


// ============================================================
// HANDLE WEARABLE SOS
// ============================================================

void handleWearableSOS() {

  sosActive =
    true;


  fallSuspected =
    false;


  Serial.println(
    "!!! WEARABLE SOS ACTIVATED !!!"
  );


  // Give GPS a moment to provide latest data
  printGPSLocation();


  snapshotContacts();   // [NEW] who gets this alert


  // [CHANGED] Save the event FIRST so the website shows it right away
  // and so the SMS / call results can be saved under it.
  currentEventKey =
    sendEmergencyEvent(
      "emergency",
      "sos"
    );


  lastAlertKey =
    currentEventKey;   // [NEW]

  lastAlertSmsSent =
    false;


  sendEmergencyNotification(
    "The Manual SOS was pressed."
  );


  currentEventKey = "";


  sendDeviceStatus();
}


// ============================================================
// HANDLE WEARABLE FALL
// ============================================================

void handleWearableFall() {

  fallSuspected =
    true;


  Serial.println(
    "!!! WEARABLE FALL DETECTED !!!"
  );


  Serial.print(
    "Acceleration: "
  );


  Serial.print(
    wearableAcceleration,
    2
  );


  Serial.println(
    " G"
  );


  // The wearable already performed
  // the 10-second confirmation.


  sosActive =
    true;


  fallSuspected =
    false;


  printGPSLocation();


  snapshotContacts();   // [NEW] who gets this alert


  // [CHANGED] Save the event FIRST (see handleWearableSOS)
  currentEventKey =
    sendEmergencyEvent(
      "confirmed",
      "fall"
    );


  lastAlertKey =
    currentEventKey;   // [NEW]

  lastAlertSmsSent =
    false;


  sendEmergencyNotification(
    "A FALL was detected (impact " + String(wearableAcceleration, 1) + " g)."
  );


  currentEventKey = "";


  sendDeviceStatus();
}


// ============================================================
// HANDLE WEARABLE CANCEL
// ============================================================

void handleWearableCancel() {

  sosActive =
    false;


  fallSuspected =
    false;


  buzzerOFF();


  cancelRequested =
    false;


  bool quiet =
    quietStop;   // [NEW] hold-2-s stop -> no "I'm OK" SMS

  quietStop =
    false;


  Serial.println(
    quiet ?
    "Emergency alert stopped quietly (no SMS, no call)." :
    "Emergency alert cancelled."
  );


  // [NEW] mark the alert as cancelled on the website
  int oi = offlineIndex(lastAlertKey);

  if (oi >= 0) {

    offlineEvents[oi].cancelled = true;

    saveOfflineEvent(oi);

  } else if (lastAlertKey.length() > 0 && firebaseReady()) {

    FirebaseJson json;

    json.set("cancelled", true);

    json.set("cancelledAt/.sv", "timestamp");

    if (quiet) {
      json.set("stoppedQuietly", true);
    }

    String path =
      "/events/" + String(DEVICE_ID) + "/" + lastAlertKey;

    Firebase.RTDB.updateNodeSilent(&fbdo, path.c_str(), &json);
  }


  // [NEW] the contact already got the emergency SMS -> tell them it's OK
  if (SEND_CANCEL_SMS && lastAlertSmsSent && !quiet) {

    sendCancelSMS();
  }


  lastAlertKey = "";

  lastAlertSmsSent = false;


  sendDeviceStatus();
}


// ============================================================
// [NEW] "I'M OK" SMS AFTER A CANCEL
// ============================================================

// sends any text message (also used for the replies to SMS commands)
bool sendTextSMS(String phone, String text) {

  if (!sim800Active || phone.length() == 0) {
    return false;
  }


  clearSIM800Buffer();

  SIM800.println("AT+CMGF=1");

  delay(300);

  clearSIM800Buffer();

  SIM800.print("AT+CMGS=\"");

  SIM800.print(phone);

  SIM800.println("\"");


  unsigned long start = millis();

  bool prompt = false;

  while (millis() - start < 5000 && !prompt) {

    if (SIM800.available() && SIM800.read() == '>') {
      prompt = true;
    }
  }


  if (!prompt) {

    Serial.println("[SMS] no prompt - text not sent");

    return false;
  }


  SIM800.print(text);

  SIM800.write(26);


  start = millis();

  String r = "";

  while (millis() - start < SMS_TIMEOUT) {

    while (SIM800.available()) r += (char)SIM800.read();

    if (r.indexOf("+CMGS:") >= 0 || r.indexOf("ERROR") >= 0) break;
  }


  bool ok = r.indexOf("+CMGS:") >= 0;

  Serial.println(ok ? "[SMS] text sent" : "[SMS] text failed");

  return ok;
}


void sendCancelSMS() {

  Serial.println("[SMS] sending 'alert cancelled' SMS to everyone who got the alert");

  for (int i = 0; i < alertContactCount; i++) {

    if (!(lastAlertSmsMask & (1u << i))) continue;

    sendTextSMS(
      alertContacts[i].phone,
      "CareBeacon UPDATE\n"
      "The alert was CANCELLED.\n"
      "The user pressed CANCEL (I'm OK)."
    );
  }
}


// ============================================================
// BUZZER
// ============================================================

// [CHANGED] The beep pattern now runs in its own background task,
// so it stays a steady "beep - beep" even while the hub is busy
// (Firebase, SMS, call). Before, it became one long beep or went silent
// whenever the hub was waiting on something.

void buzzerTask(void *param) {

  bool on = false;

  unsigned long last = 0;

  for (;;) {

    bool alarm = sosActive || fallSuspected;

    if (!alarm) {

      if (on) {
        ledcWriteTone(BUZZER_PIN, 0);
        on = false;
      }

    } else if (millis() - last >= 300) {

      last = millis();

      on = !on;

      ledcWriteTone(BUZZER_PIN, on ? BUZZER_FREQ : 0);
    }

    vTaskDelay(pdMS_TO_TICKS(10));
  }
}


void buzzerON() {

  // the buzzer task starts the beep pattern by itself (sosActive = true)
}


void buzzerOFF() {

  ledcWriteTone(
    BUZZER_PIN,
    0
  );
}


void processBuzzer() {

  // handled by buzzerTask() now - kept so the old calls still compile
}


// ============================================================
// GPS
// ============================================================

void checkGPS() {

  static unsigned long lastGPSData =
    0;


  if (
    gps.charsProcessed() > 10
  ) {

    gpsActive =
      true;


    lastGPSData =
      millis();
  }


  if (
    millis() - lastGPSData >
    5000
  ) {

    gpsActive =
      false;
  }
}


// ============================================================
// PRINT GPS
// ============================================================

void printGPSLocation() {

  if (
    gps.location.isValid()
  ) {

    Serial.println();

    Serial.println(
      "GPS LOCATION:"
    );


    Serial.print(
      "Latitude: "
    );


    Serial.println(
      gps.location.lat(),
      6
    );


    Serial.print(
      "Longitude: "
    );


    Serial.println(
      gps.location.lng(),
      6
    );


    Serial.print(
      "Google Maps: "
    );


    Serial.print(
      "https://maps.google.com/?q="
    );


    Serial.print(
      gps.location.lat(),
      6
    );


    Serial.print(",");


    Serial.println(
      gps.location.lng(),
      6
    );

  } else {

    Serial.println(
      "GPS FIX: NOT AVAILABLE"
    );
  }
}


// ============================================================
// [NEW] CONTACTS FROM THE WEBSITE
// ============================================================

// "+63 917 123 4567", "09171234567", "639171234567" -> "+639171234567" ("" if invalid)
String normalizePhone(String raw) {

  String d = "";

  for (unsigned int i = 0; i < raw.length(); i++) {
    if (isDigit(raw[i])) d += raw[i];
  }

  if (d.startsWith("63") && d.length() == 12) return "+" + d;
  if (d.startsWith("09") && d.length() == 11) return "+63" + d.substring(1);
  if (d.startsWith("9")  && d.length() == 10) return "+63" + d;
  if (raw.startsWith("+") && d.length() >= 10 && d.length() <= 15) return "+" + d;

  return "";
}


// reads  "key":"value"  out of a small JSON object
String jsonField(const String &obj, const char *key) {

  String pat = String("\"") + key + "\":\"";

  int s0 = obj.indexOf(pat);

  if (s0 < 0) return "";

  s0 += pat.length();

  String out = "";

  for (int i = s0; i < (int)obj.length(); i++) {

    char c = obj[i];

    if (c == '\\' && i + 1 < (int)obj.length()) { out += obj[++i]; continue; }

    if (c == '"') break;

    out += c;
  }

  return out;
}


// {"-Nabc":{"name":"Ana","phone":"+63 917 ..."},"-Nabd":{...}}  ->  list of contacts
int parseContacts(const String &json, String *outName, String *outPhone, int maxN) {

  int n = 0;
  int depth = 0;
  bool inStr = false;
  int objStart = -1;

  for (int i = 0; i < (int)json.length() && n < maxN; i++) {

    char c = json[i];

    if (inStr) {
      if (c == '\\') i++;
      else if (c == '"') inStr = false;
      continue;
    }

    if (c == '"') { inStr = true; continue; }

    if (c == '{') {

      depth++;

      if (depth == 2) objStart = i;

    } else if (c == '}') {

      if (depth == 2 && objStart >= 0) {

        String obj = json.substring(objStart, i + 1);

        String ph = normalizePhone(jsonField(obj, "phone"));

        bool dup = false;

        for (int k = 0; k < n; k++) if (outPhone[k] == ph) dup = true;

        if (ph.length() > 0 && !dup) {

          outName[n] = jsonField(obj, "name");
          outPhone[n] = ph;
          n++;
        }

        objStart = -1;
      }

      depth--;
    }
  }

  return n;
}


void saveContacts() {

  for (int i = 0; i < MAX_CONTACTS; i++) {

    String key = "c" + String(i);

    if (i < contactCount) {
      offlineStore.putString(key.c_str(), clean(contacts[i].name) + "|" + contacts[i].phone);
    } else {
      offlineStore.remove(key.c_str());
    }
  }

  offlineStore.putInt("ccount", contactCount);
}


void loadContacts() {

  if (!offlineStore.isKey("ccount")) {

    Serial.println("[CONTACTS] none saved yet");

    return;
  }

  contactCount = 0;

  int n = offlineStore.getInt("ccount", 0);

  for (int i = 0; i < n && i < MAX_CONTACTS; i++) {

    String v = offlineStore.getString(("c" + String(i)).c_str(), "");

    String ph = field(v, 1);

    if (ph.length() == 0) continue;

    contacts[contactCount].name = field(v, 0);
    contacts[contactCount].phone = ph;
    contactCount++;
  }

  contactsLoadedOnce = true;

  Serial.printf("[CONTACTS] %d contact(s) loaded from memory\n", contactCount);
}


// downloads families/<familyId>/contacts (familyId comes from devices/<DEVICE_ID>/familyId)
bool refreshContacts() {

  if (!firebaseReady()) return false;

  String famPath = "/devices/" + String(DEVICE_ID) + "/familyId";

  if (!Firebase.RTDB.getString(&fbdo, famPath.c_str())) {

    Serial.print("[CONTACTS] no familyId yet: ");
    Serial.println(fbdo.errorReason());

    return false;
  }

  String fid = fbdo.stringData();

  if (fid.length() == 0 || fid == "null") {

    Serial.println("[CONTACTS] this device is not linked to a family on the website yet");

    return false;
  }

  String path = "/families/" + fid + "/contacts";

  if (!Firebase.RTDB.get(&fbdo, path.c_str())) {

    Serial.print("[CONTACTS] could not read contacts: ");
    Serial.println(fbdo.errorReason());

    return false;
  }

  String tmpName[MAX_CONTACTS];
  String tmpPhone[MAX_CONTACTS];

  // no contacts at all comes back as "null" -> empty list
  String raw = (fbdo.dataType() == "json") ? fbdo.jsonString() : String("{}");

  int n = parseContacts(raw, tmpName, tmpPhone, MAX_CONTACTS);

  bool changed = (n != contactCount);

  for (int i = 0; i < n && !changed; i++) {
    if (tmpPhone[i] != contacts[i].phone || tmpName[i] != contacts[i].name) changed = true;
  }

  contactsLoadedOnce = true;

  if (changed) {

    for (int i = 0; i < n; i++) { contacts[i].name = tmpName[i]; contacts[i].phone = tmpPhone[i]; }

    contactCount = n;

    saveContacts();

    Serial.printf("[CONTACTS] updated from website: %d contact(s)\n", contactCount);

    for (int i = 0; i < contactCount; i++) {
      Serial.printf("  %d. %s  %s\n", i + 1, contacts[i].name.c_str(), contacts[i].phone.c_str());
    }
  }

  return true;
}


void contactsManager() {

  // never while an alert is being handled
  if (sosActive || currentEventKey.length() > 0) return;

  if (!firebaseReady()) return;

  if (lastContactRefresh != 0 && millis() - lastContactRefresh < CONTACT_REFRESH_MS) return;

  lastContactRefresh = millis();

  refreshContacts();
}


// copies the current list for the alert about to be sent
void snapshotContacts() {

  alertContactCount = 0;

  for (int i = 0; i < contactCount; i++) {
    alertContacts[alertContactCount++] = contacts[i];
  }

  // never got the website list (first power-on, no WiFi yet) -> use the built-in number
  if (alertContactCount == 0 && !contactsLoadedOnce && strlen(EMERGENCY_PHONE) > 0) {

    alertContacts[0].name = "Emergency contact";
    alertContacts[0].phone = String(EMERGENCY_PHONE);
    alertContactCount = 1;
  }

  Serial.printf("[CONTACTS] this alert goes to %d contact(s)\n", alertContactCount);
}


// ============================================================
// [NEW] SAVED WIFI NETWORKS
// ============================================================

void loadNetworks() {

  netCount = 0;

  for (int i = 0; i < MAX_NETS; i++) {

    String s = offlineStore.getString(("ws" + String(i)).c_str(), "");

    if (s.length() == 0) continue;

    netSsid[netCount] = s;
    netPass[netCount] = offlineStore.getString(("wp" + String(i)).c_str(), "");
    netCount++;
  }

  if (netCount == 0 && strlen(DEFAULT_SSID) > 0) {

    netSsid[0] = DEFAULT_SSID;
    netPass[0] = DEFAULT_PASS;
    netCount = 1;
  }

  Serial.printf("[WIFI] %d saved network(s)\n", netCount);
}


// newest network goes first; the hub remembers the last 3
void saveNetwork(String ssid, String pass) {

  ssid.trim();

  if (ssid.length() == 0) return;

  String newS[MAX_NETS];
  String newP[MAX_NETS];

  newS[0] = ssid;
  newP[0] = pass;

  int n = 1;

  for (int i = 0; i < netCount && n < MAX_NETS; i++) {

    if (netSsid[i] == ssid) continue;   // replaced by the new one

    newS[n] = netSsid[i];
    newP[n] = netPass[i];
    n++;
  }

  for (int i = 0; i < MAX_NETS; i++) {

    if (i < n) {
      netSsid[i] = newS[i];
      netPass[i] = newP[i];
      offlineStore.putString(("ws" + String(i)).c_str(), newS[i]);
      offlineStore.putString(("wp" + String(i)).c_str(), newP[i]);
    } else {
      netSsid[i] = "";
      netPass[i] = "";
      offlineStore.remove(("ws" + String(i)).c_str());
      offlineStore.remove(("wp" + String(i)).c_str());
    }
  }

  netCount = n;

  Serial.print("[WIFI] saved new network: ");
  Serial.println(ssid);

  // connect to it right away
  wifiIndex = 0;
  wifiTrying = false;
  wifiLastTry = millis() - WIFI_RETRY_MS;

  if (WiFi.status() == WL_CONNECTED && WiFi.SSID() != ssid) {
    WiFi.disconnect();
  }
}


// ============================================================
// [NEW] WIFI SETUP HOTSPOT
// ============================================================

String htmlEscape(String v) {

  v.replace("&", "&amp;");
  v.replace("<", "&lt;");
  v.replace(">", "&gt;");
  v.replace("\"", "&quot;");

  return v;
}


void portalRoot() {

  String html =
    "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>CareBeacon WiFi</title><style>"
    "body{font-family:sans-serif;max-width:420px;margin:20px auto;padding:0 16px;color:#222}"
    "input,select,button{width:100%;padding:12px;margin:6px 0 14px;font-size:16px;box-sizing:border-box}"
    "button{background:#2f5d8a;color:#fff;border:0;border-radius:8px}"
    "</style></head><body><h2>CareBeacon WiFi setup</h2>"
    "<p>Choose your home WiFi (2.4 GHz) and type its password.</p>"
    "<form method='POST' action='/save'><label>Network</label><select name='s'>";

  int n = WiFi.scanComplete();

  for (int i = 0; i < n; i++) {

    String name = WiFi.SSID(i);

    if (name.length() == 0) continue;

    html += "<option value='" + htmlEscape(name) + "'>" + htmlEscape(name) + "</option>";
  }

  html +=
    "</select><label>...or type the WiFi name</label><input name='m' placeholder='WiFi name (optional)'>"
    "<label>Password</label><input name='p' type='password'>"
    "<button type='submit'>Save and connect</button></form>"
    "<p><a href='/scan'>Scan again</a></p></body></html>";

  portalServer.send(200, "text/html", html);
}


void portalSave() {

  String ssid = portalServer.arg("m");

  if (ssid.length() == 0) ssid = portalServer.arg("s");

  ssid.trim();

  String pass = portalServer.arg("p");

  if (ssid.length() == 0) {

    portalServer.send(200, "text/html", "<html><body style='font-family:sans-serif'><h3>Please choose or type a WiFi name.</h3><a href='/'>Back</a></body></html>");

    return;
  }

  portalServer.send(200, "text/html",
    "<html><body style='font-family:sans-serif;padding:20px'><h3>Saved</h3>"
    "<p>The hub is connecting to <b>" + htmlEscape(ssid) + "</b>. You can close this page.</p>"
    "<p>If it does not connect, check the password and join this hotspot again.</p></body></html>");

  delay(300);

  saveNetwork(ssid, pass);
}


void portalScan() {

  WiFi.scanNetworks();

  portalServer.sendHeader("Location", "/");

  portalServer.send(302, "text/plain", "");
}


void portalNotFound() {

  // makes the phone open the setup page by itself (captive portal)
  portalServer.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/");

  portalServer.send(302, "text/plain", "");
}


void startPortal() {

  if (portalOn || sosActive) return;

  String name = "CareBeacon-Setup-" + WiFi.macAddress().substring(12);

  name.replace(":", "");

  WiFi.mode(WIFI_AP_STA);

  WiFi.softAP(name.c_str(), PORTAL_PASS, OFFLINE_CHANNEL);

  dnsServer.start(53, "*", WiFi.softAPIP());

  portalServer.on("/", portalRoot);
  portalServer.on("/save", HTTP_POST, portalSave);
  portalServer.on("/scan", portalScan);
  portalServer.onNotFound(portalNotFound);
  portalServer.begin();

  WiFi.scanNetworks(true);   // list nearby networks (in the background)

  portalOn = true;

  portalStart = millis();

  Serial.println();
  Serial.println("################################################");
  Serial.print  ("  WIFI SETUP HOTSPOT ON:  ");
  Serial.println(name);
  Serial.println("  Password: " PORTAL_PASS);
  Serial.println("  Join it with a phone, the setup page opens.");
  Serial.println("  (or go to http://192.168.4.1)");
  Serial.println("################################################");
}


void stopPortal() {

  if (!portalOn) return;

  portalServer.stop();

  dnsServer.stop();

  WiFi.softAPdisconnect(true);

  WiFi.mode(WIFI_STA);

  portalOn = false;

  portalEverClosed = true;

  portalClosedAt = millis();

  Serial.println("[PORTAL] setup hotspot closed");
}


void portalLoop() {

  if (!portalOn) return;

  dnsServer.processNextRequest();

  portalServer.handleClient();
}


// opens the hotspot automatically when the hub has no WiFi for a while
void portalManager() {

  static unsigned long offlineSince = 0;

  bool connected = WiFi.status() == WL_CONNECTED;

  if (connected) {

    offlineSince = 0;

    if (portalOn) stopPortal();

    return;
  }

  if (offlineSince == 0) offlineSince = millis();

  if (portalOn) {

    if (sosActive || millis() - portalStart > PORTAL_MAX_MS) stopPortal();

    return;
  }

  if (sosActive) return;

  // no network saved at all: open soon. Saved network failing: wait 3 minutes.
  unsigned long waitMs = (netCount == 0) ? 30000UL : 180000UL;

  bool cooled = !portalEverClosed || (millis() - portalClosedAt > PORTAL_COOLDOWN_MS);

  if (millis() - offlineSince > waitMs && cooled) {
    startPortal();
  }
}


// ============================================================
// [NEW] SMS COMMANDS  (only from a registered contact's phone)
// ============================================================
//   WIFI <name>;<password>   change the WiFi
//   STATUS                   hub replies with its state
//   SETUP                    open the setup hotspot for 10 minutes

bool isAuthorizedSender(String sender) {

  String p = normalizePhone(sender);

  if (p.length() == 0) return false;

  for (int i = 0; i < contactCount; i++) {
    if (contacts[i].phone == p) return true;
  }

  if (contactCount == 0 && !contactsLoadedOnce && normalizePhone(EMERGENCY_PHONE) == p) return true;

  return false;
}


void processIncomingSMS() {

  if (pendingSmsIdx <= 0 || sosActive || !sim800Active) return;

  int idx = pendingSmsIdx;

  pendingSmsIdx = 0;

  clearSIM800Buffer();

  SIM800.println("AT+CMGR=" + String(idx));

  String r = "";

  unsigned long t0 = millis();

  while (millis() - t0 < 3000) {

    while (SIM800.available()) r += (char)SIM800.read();

    if (r.indexOf("\nOK") >= 0 || r.indexOf("ERROR") >= 0) break;

    delay(5);
  }

  int h = r.indexOf("+CMGR:");

  if (h < 0) {
    sendSIM800Command("AT+CMGD=" + String(idx), "OK", 2000);
    return;
  }

  // +CMGR: "REC UNREAD","+639xxxxxxxxx","","26/10/15,10:00:00+32"
  int q1 = r.indexOf('"', h);
  int q2 = q1 >= 0 ? r.indexOf('"', q1 + 1) : -1;
  int q3 = q2 >= 0 ? r.indexOf('"', q2 + 1) : -1;
  int q4 = q3 >= 0 ? r.indexOf('"', q3 + 1) : -1;

  String sender = (q3 >= 0 && q4 > q3) ? r.substring(q3 + 1, q4) : "";

  int le = r.indexOf('\n', h);

  int okAt = r.indexOf("\nOK", le);

  String body = (le >= 0) ? r.substring(le + 1, okAt > le ? okAt : r.length()) : "";

  body.trim();

  sendSIM800Command("AT+CMGD=" + String(idx), "OK", 2000);

  Serial.print("[SMS-CMD] from ");
  Serial.print(sender);
  Serial.print(": ");
  Serial.println(body);

  if (!isAuthorizedSender(sender)) {

    Serial.println("[SMS-CMD] ignored - sender is not a registered contact");

    return;
  }

  String phone = normalizePhone(sender);

  String up = body;

  up.toUpperCase();

  if (up.startsWith("WIFI")) {

    String rest = body.substring(4);

    rest.trim();

    int sc = rest.indexOf(';');

    String ssid = sc < 0 ? rest : rest.substring(0, sc);

    String pass = sc < 0 ? "" : rest.substring(sc + 1);

    ssid.trim();

    if (ssid.length() == 0) {

      sendTextSMS(phone, "CareBeacon: to change the WiFi text:\nWIFI WiFiName;Password");

      return;
    }

    sendTextSMS(phone, "CareBeacon: WiFi saved (" + ssid + "). The hub is connecting now. Text STATUS to check.");

    saveNetwork(ssid, pass);

  } else if (up.startsWith("STATUS")) {

    String msg = "CareBeacon status\n";

    msg += (WiFi.status() == WL_CONNECTED) ? "WiFi: " + WiFi.SSID() : String("WiFi: not connected");

    msg += "\nContacts: " + String(contactCount);

    msg += String("\nGPS: ") + (gps.location.isValid() ? "fix" : "no fix");

    msg += String("\nWearable: ") + (wearableConnected ? "connected" : "disconnected");

    sendTextSMS(phone, msg);

  } else if (up.startsWith("SETUP")) {

    startPortal();

    sendTextSMS(phone, "CareBeacon: setup hotspot is ON for 10 min. Join the WiFi CareBeacon-Setup (password " PORTAL_PASS ") with your phone.");
  }
}


// ============================================================
// FIREBASE READY
// ============================================================

bool firebaseReady() {

  if (
    WiFi.status() !=
    WL_CONNECTED ||
    !firebaseStarted
  ) {

    return false;
  }


  if (
    !Firebase.ready()
  ) {

    return false;
  }


  return true;
}


// ============================================================
// FIREBASE DEVICE STATUS
// ============================================================

void sendDeviceStatus() {

  if (!firebaseReady()) {

    return;   // [CHANGED] offline: stay quiet (no "Not ready" spam)
  }


  String status;


  if (sosActive) {

    status =
      "emergency";

  } else if (wearableConnected) {

    status =
      "online";

  } else {

    status =
      "wearable_disconnected";
  }


  FirebaseJson json;


  json.set(
    "status",
    status
  );


  json.set(
    "deviceId",
    DEVICE_ID
  );


  json.set(
    "wearableConnected",
    wearableConnected
  );


  json.set(
    "wearableAcceleration",
    wearableAcceleration
  );


  json.set(
    "gpsFix",
    gps.location.isValid()
  );


  json.set(
    "sosActive",
    sosActive
  );


  json.set(
    "fallSuspected",
    fallSuspected
  );


  if (
    gps.location.isValid()
  ) {

    json.set(
      "location/lat",
      gps.location.lat()
    );


    json.set(
      "location/lng",
      gps.location.lng()
    );

  }
  // [CHANGED] no GPS fix -> keep the last known location on the website
  // (before, it was overwritten with 0,0)


  json.set(
    "wifiConnected",
    WiFi.status() ==
    WL_CONNECTED
  );


  json.set(
    "ipAddress",
    WiFi.localIP().toString()
  );


  json.set(
    "uptime",
    (int)millis()
  );


  // [CHANGED] real date/time from the Firebase server (was millis())
  json.set(
    "lastUpdate/.sv",
    "timestamp"
  );


  String path =
    "/devices/" +
    String(DEVICE_ID);


  // [CHANGED] updateNode instead of setJSON.
  // setJSON REPLACED the whole /devices/<ID> record every 10 s and
  // deleted familyId, batteries and fcmTokens that the website saved there.
  // updateNode only changes the fields listed above.
  if (
    Firebase.RTDB.updateNode(
      &fbdo,
      path.c_str(),
      &json
    )
  ) {

    Serial.println(
      "[FIREBASE] Device status updated"
    );


    firebaseActive =
      true;

  } else {

    Serial.print(
      "[FIREBASE] Error: "
    );


    Serial.println(
      fbdo.errorReason()
    );


    firebaseActive =
      false;
  }
}


// ============================================================
// FIREBASE EMERGENCY EVENT
// ============================================================
// [CHANGED]
//  - adds "type" ("fall" or "sos")
//  - timestamp is the real server time (was millis())
//  - creates delivery/contact1 with sms + call = "queued"
//  - returns the new event key so SMS / call results can be saved under it

String sendEmergencyEvent(
  String eventStatus,
  String eventType
) {

  if (!firebaseReady()) {

    // [NEW] no WiFi -> keep it and upload later
    for (int i = 0; i < OFFLINE_MAX; i++) {

      if (!offlineEvents[i].used) {

        OfflineEvent &e = offlineEvents[i];

        e.used = true;
        e.status = eventStatus;
        e.type = eventType;
        e.atMillis = millis();
        e.acc = wearableAcceleration;
        String locNote;
        e.hasLoc = getAlertLocation(e.lat, e.lng, locNote);   // [CHANGED] current or last known
        if (!e.hasLoc) { e.lat = 0; e.lng = 0; }
        e.smsCodes = "";  e.smsResp = "";
        e.callCodes = ""; e.callResp = "";
        e.phones = "";
        for (int k = 0; k < alertContactCount; k++) {
          e.smsCodes += 'q';
          e.callCodes += 'q';
          if (k > 0) e.phones += ",";
          e.phones += alertContacts[k].phone;
        }
        e.cancelled = false;
        e.epoch = nowEpoch();
        e.boot = bootId;

        saveOfflineEvent(i);

        Serial.print("[OFFLINE] no WiFi - alert saved in memory, will upload later (slot ");
        Serial.print(i);
        Serial.println(")");

        return "offline:" + String(i);
      }
    }

    Serial.println("[OFFLINE] queue full - this alert will not reach the website");

    return "";
  }


  FirebaseJson json;


  json.set(
    "deviceId",
    DEVICE_ID
  );


  json.set(
    "status",
    eventStatus
  );


  json.set(
    "type",
    eventType
  );


  json.set(
    "timestamp/.sv",
    "timestamp"
  );


  json.set(
    "hubMillis",
    (int)millis()
  );


  json.set(
    "acceleration",
    wearableAcceleration
  );


  json.set(
    "source",
    "wearable"
  );


  json.set(
    "gpsFix",
    gps.location.isValid()
  );


  // [CHANGED] current fix, or the last known location (marked as such)
  double evLat, evLng;
  String evNote;

  if (
    getAlertLocation(evLat, evLng, evNote)
  ) {

    json.set(
      "location/lat",
      evLat
    );


    json.set(
      "location/lng",
      evLng
    );


    if (evNote.length()) {

      json.set("locationLastKnown", true);

      json.set("locationNote", "Last known location (" + evNote + ")");
    }
  }


  // Who will be alerted (every registered contact).
  // Results are filled in later by writeDelivery().
  for (int k = 0; k < alertContactCount; k++) {

    String base = "delivery/contact" + String(k + 1);

    json.set(base + "/contactName", alertContacts[k].name.length() ? alertContacts[k].name : String("Emergency contact"));
    json.set(base + "/phone", alertContacts[k].phone);
    json.set(base + "/sms/status", "queued");
    json.set(base + "/sms/provider", "SIM800L");
    json.set(base + "/call/status", "queued");
    json.set(base + "/call/provider", "SIM800L");
  }


  String path =
    "/events/" +
    String(DEVICE_ID);


  if (
    Firebase.RTDB.pushJSON(
      &fbdo,
      path.c_str(),
      &json
    )
  ) {

    String key =
      fbdo.pushName();


    Serial.println(
      "[FIREBASE] Emergency event sent"
    );


    Serial.print(
      "Event ID: "
    );


    Serial.println(
      key
    );


    return key;

  } else {

    Serial.print(
      "[FIREBASE] Event error: "
    );


    Serial.println(
      fbdo.errorReason()
    );


    return "";
  }
}


// ============================================================
// [NEW] SAVE SMS / CALL RESULT TO FIREBASE
// ============================================================
// Writes to: events/<DEVICE_ID>/<eventKey>/delivery/contact<N>/<sms|call>
//   { status, response, provider, updatedAt }
// The website's Alert Delivery page reads this.

// status words <-> one letter (used for alerts kept in flash while offline)
char statusToCode(String st) {

  if (st == "queued")    return 'q';
  if (st == "sent")      return 's';
  if (st == "delivered") return 'd';
  if (st == "failed")    return 'f';
  if (st == "cancelled") return 'c';
  if (st == "answered")  return 'a';
  if (st == "no answer") return 'n';
  if (st == "busy")      return 'b';
  if (st == "dialing")   return 'g';
  if (st == "skipped")   return 'x';

  return 'q';
}


String codeToStatus(char c) {

  switch (c) {
    case 's': return "sent";
    case 'd': return "delivered";
    case 'f': return "failed";
    case 'c': return "cancelled";
    case 'a': return "answered";
    case 'n': return "no answer";
    case 'b': return "busy";
    case 'g': return "dialing";
    case 'x': return "skipped";
  }

  return "queued";
}


void writeDeliveryFor(
  String eventKey,
  int idx,
  String channel,
  String status,
  String response
) {

  Serial.print("[DELIVERY] ");
  Serial.print(channel);
  Serial.print(" #");
  Serial.print(idx + 1);
  Serial.print(" = ");
  Serial.println(status);


  if (eventKey.length() == 0) {

    // event was not saved - nothing to attach to
    return;
  }


  // [NEW] offline alert -> remember the result for the later upload
  int oi = offlineIndex(eventKey);

  if (oi >= 0) {

    OfflineEvent &e = offlineEvents[oi];

    String &codes = (channel == "sms") ? e.smsCodes : e.callCodes;

    while ((int)codes.length() <= idx) codes += 'q';

    codes.setCharAt(idx, statusToCode(status));

    if (channel == "sms") {
      e.smsResp = response;
    } else {
      e.callResp = response;
    }

    saveOfflineEvent(oi);

    return;
  }


  if (!firebaseReady()) {

    Serial.println("[DELIVERY] Firebase not ready - result not saved");

    return;
  }


  FirebaseJson json;

  json.set("status", status);

  json.set("provider", "SIM800L");

  json.set("updatedAt/.sv", "timestamp");

  if (response.length() > 0) {

    json.set("response", response);
  }


  String path =
    "/events/" +
    String(DEVICE_ID) +
    "/" +
    eventKey +
    "/delivery/contact" +
    String(idx + 1) +
    "/" +
    channel;


  if (
    !Firebase.RTDB.updateNode(
      &fbdo,
      path.c_str(),
      &json
    )
  ) {

    Serial.print("[DELIVERY] Firebase error: ");

    Serial.println(fbdo.errorReason());
  }
}


// result for the contact that is being texted / called right now
void writeDelivery(
  String eventKey,
  String channel,
  String status,
  String response
) {

  writeDeliveryFor(eventKey, currentContact, channel, status, response);
}


// ============================================================
// FIREBASE HEARTBEAT
// ============================================================

void firebaseHeartbeat() {

  if (
    millis() - lastFirebaseUpdate >=
    FIREBASE_INTERVAL
  ) {

    lastFirebaseUpdate =
      millis();


    // Check wearable connection
    if (
      millis() - lastWearableMessage >
      WEARABLE_TIMEOUT
    ) {

      wearableConnected =
        false;
    }


    sendDeviceStatus();
  }
}


// ============================================================
// [NEW] PRINT HUB MAC (copy-paste ready for the wrist code)
// ============================================================

void printHubMAC() {

  uint8_t mac[6];

  WiFi.macAddress(mac);

  Serial.println();
  Serial.println("################################################");
  Serial.print  ("  HUB MAC: ");
  Serial.println(WiFi.macAddress());
  Serial.println("  Paste this line into the wrist code (HUB_MAC):");
  Serial.printf ("  uint8_t HUB_MAC[6] = {0x%02X, 0x%02X, 0x%02X, 0x%02X, 0x%02X, 0x%02X};\n",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  Serial.println("################################################");
  Serial.println();
}


// ============================================================
// WIFI
// ============================================================

void connectWiFi() {

  // [CHANGED] does NOT wait for WiFi any more.
  // The hub starts working right away; wifiManager() (in loop)
  // connects in the background and reconnects if WiFi drops.

  WiFi.mode(
    WIFI_STA
  );

  WiFi.setTxPower(WIFI_POWER_8_5dBm);   // helps ESP32-C3 Super Mini boards connect
  WiFi.setSleep(false);   // keep radio awake so ESP-NOW messages are not missed
  WiFi.setAutoReconnect(false);   // wifiManager() handles reconnecting


  // stay on a fixed channel while offline so the wrist finds the hub fast
  esp_wifi_set_channel(OFFLINE_CHANNEL, WIFI_SECOND_CHAN_NONE);


  // [NEW] show the MAC right away
  printHubMAC();


  Serial.println(
    "[WIFI] will connect in the background - hub already works without it"
  );


  wifiLastTry = millis() - WIFI_RETRY_MS;   // first try right away
}


// ============================================================
// [NEW] BACKGROUND WIFI MANAGER
// ============================================================

void wifiManager() {

  bool connected =
    WiFi.status() == WL_CONNECTED;


  // just connected
  if (connected && !wifiWasConnected) {

    wifiWasConnected = true;

    wifiTrying = false;

    Serial.print("[WIFI] connected to ");
    Serial.print(WiFi.SSID());
    Serial.print("  IP ");
    Serial.print(WiFi.localIP());
    Serial.print("  channel ");
    Serial.println(WiFi.channel());

    // real clock for offline alerts
    configTime(0, 0, "pool.ntp.org", "time.google.com");

    // [NEW] start Firebase only now (no token errors while offline)
    if (!firebaseStarted) {

      initializeFirebase();

      firebaseStarted = true;
    }
  }


  // just lost WiFi
  if (!connected && wifiWasConnected) {

    wifiWasConnected = false;

    Serial.println("[WIFI] lost - hub keeps working offline");

    WiFi.disconnect();

    esp_wifi_set_channel(OFFLINE_CHANNEL, WIFI_SECOND_CHAN_NONE);

    wifiLastTry = millis();
  }


  if (connected) {

    flushOfflineEvents();

    return;
  }


  // don't search for WiFi during an alarm (keeps the radio free for the wrist)
  if (sosActive) {
    return;
  }


  // an attempt is running
  if (wifiTrying) {

    if (millis() - wifiTryStart > WIFI_TRY_MS) {

      Serial.print("[WIFI] could not connect to ");
      Serial.println(netSsid[wifiIndex]);

      WiFi.disconnect();

      esp_wifi_set_channel(OFFLINE_CHANNEL, WIFI_SECOND_CHAN_NONE);

      wifiTrying = false;

      wifiLastTry = millis();

      if (netCount > 0) wifiIndex = (wifiIndex + 1) % netCount;
    }

    return;
  }


  // time for the next attempt?
  if (millis() - wifiLastTry < WIFI_RETRY_MS) {
    return;
  }


  // [CHANGED] networks come from flash (set by SMS or the setup page)
  if (netCount == 0) {

    wifiLastTry = millis();   // no network saved yet - stay offline

    return;
  }

  if (wifiIndex >= netCount) wifiIndex = 0;

  Serial.print("[WIFI] trying ");
  Serial.println(netSsid[wifiIndex]);

  WiFi.begin(netSsid[wifiIndex].c_str(), netPass[wifiIndex].c_str());

  wifiTrying = true;

  wifiTryStart = millis();
}


// ============================================================
// [NEW] OFFLINE ALERTS -> FIREBASE
// ============================================================

int offlineIndex(String key) {

  if (!key.startsWith("offline:")) {
    return -1;
  }

  int i = key.substring(8).toInt();

  return (i >= 0 && i < OFFLINE_MAX && offlineEvents[i].used) ? i : -1;
}


void flushOfflineEvents() {

  // not while an alert is still being handled
  if (sosActive || currentEventKey.length() > 0) {
    return;
  }


  bool any = false;

  for (int i = 0; i < OFFLINE_MAX; i++) {
    if (offlineEvents[i].used) any = true;
  }

  if (!any || !firebaseReady()) {
    return;
  }


  time_t nowSec = time(nullptr);

  if (nowSec < 1700000000) {
    return;   // clock not synced yet - try again next loop
  }


  for (int i = 0; i < OFFLINE_MAX; i++) {

    OfflineEvent &e = offlineEvents[i];

    if (!e.used) continue;


    // real time of the alert (seconds since 1970)
    //  1. saved real time (clock or GPS time was known)  -> exact
    //  2. same power-on as now -> now minus how long ago  -> exact
    //  3. hub restarted since, no clock then              -> upload time (approximate)
    bool approx = false;

    int atSec;

    if (e.epoch > 1700000000UL) {
      atSec = (int)e.epoch;
    } else if (e.boot == bootId) {
      atSec = (int)(nowSec - (time_t)((millis() - e.atMillis) / 1000));
    } else {
      atSec = (int)nowSec;
      approx = true;
    }


    FirebaseJson json;

    json.set("deviceId", DEVICE_ID);
    json.set("status", e.status);
    json.set("type", e.type);
    json.set("timestamp", atSec);
    json.set("offline", true);

    if (approx) {
      json.set("timeApproximate", true);
    }
    json.set("acceleration", e.acc);
    json.set("source", "wearable");
    json.set("gpsFix", e.hasLoc);

    if (e.hasLoc) {
      json.set("location/lat", e.lat);
      json.set("location/lng", e.lng);
    }

    if (e.cancelled) {
      json.set("cancelled", true);
    }

    {
      String ph = e.phones;

      int from = 0;

      for (int n = 0; n < MAX_CONTACTS; n++) {

        int to = ph.indexOf(',', from);

        String p = to < 0 ? ph.substring(from) : ph.substring(from, to);

        if (p.length() > 0) {

          String base = "delivery/contact" + String(n + 1);

          String nm = "Emergency contact";

          for (int k = 0; k < contactCount; k++) {
            if (contacts[k].phone == p && contacts[k].name.length()) nm = contacts[k].name;
          }

          json.set(base + "/contactName", nm);
          json.set(base + "/phone", p);
          json.set(base + "/sms/status", codeToStatus((int)e.smsCodes.length() > n ? e.smsCodes[n] : 'q'));
          json.set(base + "/sms/provider", "SIM800L");
          json.set(base + "/call/status", codeToStatus((int)e.callCodes.length() > n ? e.callCodes[n] : 'q'));
          json.set(base + "/call/provider", "SIM800L");
        }

        if (to < 0) break;

        from = to + 1;
      }

      if (e.smsResp.length())  json.set("delivery/contact1/sms/response", e.smsResp);
      if (e.callResp.length()) json.set("delivery/contact1/call/response", e.callResp);
    }


    String path = "/events/" + String(DEVICE_ID);

    if (Firebase.RTDB.pushJSON(&fbdo, path.c_str(), &json)) {

      String newKey = fbdo.pushName();

      Serial.print("[OFFLINE] uploaded saved alert -> ");
      Serial.println(newKey);

      // a delivery report / cancel may still arrive for it
      String oldKey = "offline:" + String(i);
      if (lastSmsEventKey == oldKey) lastSmsEventKey = newKey;
      if (lastAlertKey == oldKey)    lastAlertKey = newKey;

      e.used = false;

      saveOfflineEvent(i);   // removes it from flash memory

    } else {

      Serial.print("[OFFLINE] upload failed: ");
      Serial.println(fbdo.errorReason());

      return;   // try again later
    }
  }
}


// ============================================================
// [NEW] LAST KNOWN LOCATION
// ============================================================

// call often: remembers every good GPS fix, saves it to flash every 2 min
void trackLastFix() {

  if (!gps.location.isValid() || gps.location.age() > 5000) {
    return;   // no fresh fix right now
  }

  lastFixLat = gps.location.lat();
  lastFixLng = gps.location.lng();
  lastFixMillis = millis() == 0 ? 1 : millis();
  lastFixEpoch = nowEpoch();
  haveLastFix = true;

  if (lastFixSaved == 0 || millis() - lastFixSaved > 120000) {

    lastFixSaved = millis();

    offlineStore.putDouble("lat", lastFixLat);
    offlineStore.putDouble("lng", lastFixLng);
    offlineStore.putUInt("fixT", lastFixEpoch);
  }
}


// location for an alert: fresh fix -> note "", otherwise last known -> note "x min ago"
bool getAlertLocation(double &lat, double &lng, String &note) {

  note = "";

  if (gps.location.isValid() && gps.location.age() < 10000) {

    lat = gps.location.lat();
    lng = gps.location.lng();

    return true;
  }

  if (!haveLastFix) {
    return false;
  }

  lat = lastFixLat;
  lng = lastFixLng;

  long agoMin = -1;

  if (lastFixMillis > 0) {

    agoMin = (long)((millis() - lastFixMillis) / 60000UL);

  } else if (lastFixEpoch > 1700000000UL && nowEpoch() > lastFixEpoch) {

    agoMin = (long)((nowEpoch() - lastFixEpoch) / 60UL);
  }

  if (agoMin < 0)        note = "time unknown";
  else if (agoMin < 1)   note = "less than 1 min ago";
  else if (agoMin < 120) note = String((int)agoMin) + " min ago";
  else                   note = String((int)(agoMin / 60)) + " h ago";

  return true;
}


// ============================================================
// [NEW] OFFLINE MEMORY (flash) + REAL TIME
// ============================================================

// real time now, from the internet clock or from the GPS; 0 if unknown
uint32_t nowEpoch() {

  time_t t = time(nullptr);

  if (t > 1700000000) {
    return (uint32_t)t;
  }

  if (gps.date.isValid() && gps.time.isValid() && gps.date.year() >= 2024) {

    // days since 1970 for the GPS date (UTC)
    int y = gps.date.year(), m = gps.date.month(), d = gps.date.day();
    y -= m <= 2;
    int era = y / 400;
    int yoe = y - era * 400;
    int doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    int doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    long days = (long)era * 146097 + doe - 719468;

    return (uint32_t)(days * 86400L
                      + gps.time.hour() * 3600L
                      + gps.time.minute() * 60L
                      + gps.time.second());
  }

  return 0;
}


String clean(String v) {
  v.replace("|", "/");
  v.replace("\n", " ");
  v.replace("\r", " ");
  return v;
}


// save one slot to flash (or delete it if the slot is empty)
void saveOfflineEvent(int i) {

  String key = "e" + String(i);

  OfflineEvent &e = offlineEvents[i];

  if (!e.used) {
    offlineStore.remove(key.c_str());
    return;
  }

  String v =
    clean(e.status) + "|" + clean(e.type) + "|" +
    String((unsigned long)e.epoch) + "|" + String((unsigned long)e.boot) + "|" + String((unsigned long)e.atMillis) + "|" +
    String(e.acc, 2) + "|" + String(e.hasLoc ? 1 : 0) + "|" +
    String(e.lat, 6) + "|" + String(e.lng, 6) + "|" +
    "#" + clean(e.smsCodes) + "|" + clean(e.smsResp) + "|" +
    "#" + clean(e.callCodes) + "|" + clean(e.callResp) + "|" +
    String(e.cancelled ? 1 : 0) + "|" + clean(e.phones);

  offlineStore.putString(key.c_str(), v);
}


// read field n from "a|b|c"
String field(const String &s, int n) {

  int from = 0;

  for (int i = 0; i < n; i++) {
    from = s.indexOf('|', from);
    if (from < 0) return "";
    from++;
  }

  int to = s.indexOf('|', from);

  return to < 0 ? s.substring(from) : s.substring(from, to);
}


// at start-up: count this restart and load saved offline alerts
void loadOfflineEvents() {

  offlineStore.begin("carebeacon", false);

  bootId = offlineStore.getUInt("boot", 0) + 1;

  offlineStore.putUInt("boot", bootId);


  int count = 0;

  for (int i = 0; i < OFFLINE_MAX; i++) {

    String v = offlineStore.getString(("e" + String(i)).c_str(), "");

    OfflineEvent &e = offlineEvents[i];

    if (v.length() == 0) {
      e.used = false;
      continue;
    }

    e.used       = true;
    e.status     = field(v, 0);
    e.type       = field(v, 1);
    e.epoch      = (uint32_t)field(v, 2).toInt();
    e.boot       = (uint32_t)field(v, 3).toInt();
    e.atMillis   = (unsigned long)field(v, 4).toInt();
    e.acc        = field(v, 5).toFloat();
    e.hasLoc     = field(v, 6) == "1";
    e.lat        = field(v, 7).toDouble();
    e.lng        = field(v, 8).toDouble();
    String sc = field(v, 9);
    String cc = field(v, 11);

    if (sc.startsWith("#")) {

      // current format: one letter per contact + the phone list
      e.smsCodes  = sc.substring(1);
      e.callCodes = cc.substring(1);
      e.phones    = field(v, 14);

    } else {

      // alert saved by the older firmware (single contact, status words)
      e.smsCodes  = String(statusToCode(sc));
      e.callCodes = String(statusToCode(cc));
      e.phones    = String(EMERGENCY_PHONE);
    }

    e.smsResp    = field(v, 10);
    e.callResp   = field(v, 12);
    e.cancelled  = field(v, 13) == "1";

    count++;
  }


  Serial.printf("[OFFLINE] memory: %d saved alert(s) waiting for upload\n", count);


  // [NEW] last known location from before the restart
  if (offlineStore.isKey("lat")) {

    lastFixLat = offlineStore.getDouble("lat", 0);
    lastFixLng = offlineStore.getDouble("lng", 0);
    lastFixEpoch = offlineStore.getUInt("fixT", 0);
    lastFixMillis = 0;          // happened before this restart
    haveLastFix = (lastFixLat != 0 || lastFixLng != 0);

    if (haveLastFix) {
      Serial.printf("[GPS] last known location loaded: %.6f, %.6f\n", lastFixLat, lastFixLng);
    }
  }
}


// quiet Firebase sign-in messages (prints only when the state changes)
void quietTokenCallback(TokenInfo info) {

  static int lastStatus = -1;

  if ((int)info.status == lastStatus) {
    return;
  }

  lastStatus = (int)info.status;

  if (info.status == token_status_ready) {
    Serial.println("[FIREBASE] signed in - website sync ON");
  } else if (info.status == token_status_error) {
    Serial.print("[FIREBASE] sign-in problem: ");
    Serial.println(info.error.message.c_str());
  }
}


// ============================================================
// FIREBASE INITIALIZATION
// ============================================================

void initializeFirebase() {

  Serial.println();

  Serial.println(
    "Initializing Firebase..."
  );


  config.api_key =
    API_KEY;


  config.database_url =
    DATABASE_URL;


  auth.user.email =
    FIREBASE_USER_EMAIL;


  auth.user.password =
    FIREBASE_USER_PASSWORD;


  config.token_status_callback =
    quietTokenCallback;   // [CHANGED] no repeating token messages


  Firebase.reconnectNetwork(
    false     // [CHANGED] wifiManager() handles WiFi
  );


  config.timeout.serverResponse =
    15 * 1000;   // [NEW] wait up to 15 s for Firebase


  fbdo.setBSSLBufferSize(
    4096,
    1024
  );


  fbdo.setResponseSize(
    4096
  );


  Firebase.begin(
    &config,
    &auth
  );


  Serial.println(
    "[OK] Firebase initialized"
  );
}


// ============================================================
// SETUP
// ============================================================

void setup() {

  Serial.begin(
    115200
  );


  delay(1000);


  Serial.println();

  Serial.println(
    "================================"
  );

  Serial.println(
    " CAREBEACON CENTRAL HUB"
  );

  Serial.println(
    " ESP32-C3"
  );

  Serial.println(
    " GPS + SIM800L + FIREBASE"
  );

  Serial.println(
    "================================"
  );


  // ----------------------------------------------------------
  // BUZZER
  // ----------------------------------------------------------

  pinMode(
    BUZZER_PIN,
    OUTPUT
  );


  // [CHANGED] buzzer driven by LEDC + its own task (steady beep pattern)
  ledcAttach(
    BUZZER_PIN,
    BUZZER_FREQ,
    8
  );


  buzzerOFF();


  xTaskCreate(
    buzzerTask,
    "buzzer",
    2048,
    NULL,
    2,
    NULL
  );


  // ----------------------------------------------------------
  // WIFI
  // ----------------------------------------------------------

  connectWiFi();


  // ----------------------------------------------------------
  // ESP-NOW
  // ----------------------------------------------------------

  initializeESPNow();


  // ----------------------------------------------------------
  // GPS
  // ----------------------------------------------------------

  // [NEW] bigger receive buffer so GPS data is not lost while the hub
  // is busy (Firebase / SMS / call) - lost data = no fix
  GPS.setRxBufferSize(1024);


  GPS.begin(
    9600,
    SERIAL_8N1,
    GPS_RX,
    GPS_TX
  );


  Serial.println(
    "[OK] GPS serial started"
  );


  // ----------------------------------------------------------
  // FIREBASE + OFFLINE MEMORY
  // ----------------------------------------------------------

  // [CHANGED] Firebase starts automatically when WiFi connects
  // (see wifiManager). Here we only load alerts saved while offline.
  loadOfflineEvents();

  loadContacts();    // [NEW] contacts saved from the website

  loadNetworks();    // [NEW] WiFi networks saved by SMS / setup page


  // ----------------------------------------------------------
  // SIM800
  // ----------------------------------------------------------

  initializeSIM800();


  // ----------------------------------------------------------
  // STARTUP
  // ----------------------------------------------------------

  startupTime =
    millis();


  Serial.println();

  Serial.println(
    "================================"
  );

  Serial.println(
    "CENTRAL HUB READY"
  );


  // [NEW] show the MAC again so it is easy to find
  printHubMAC();

  Serial.println(
    "================================"
  );

  Serial.println(
    "Waiting for wearable..."
  );
}


// ============================================================
// LOOP
// ============================================================

void loop() {

  // ----------------------------------------------------------
  // GPS
  // ----------------------------------------------------------

  while (
    GPS.available()
  ) {

    gps.encode(
      GPS.read()
    );
  }


  checkGPS();


  trackLastFix();   // [NEW] remember the latest good GPS position


  // ----------------------------------------------------------
  // [NEW] SIM800L messages (SMS delivery reports arrive later)
  // ----------------------------------------------------------

  pollSIM800();


  // ----------------------------------------------------------
  // WEARABLE ALERTS (from ESP-NOW callback)
  // ----------------------------------------------------------

  if (pendingMessage) {
    pendingMessage = false;
    uint8_t t = pendingMessageType;
    if (t == MSG_SOS) {
      sosActive = true;  buzzerON();          // sound right away
      handleWearableSOS();
    } else if (t == MSG_FALL) {
      sosActive = true;  buzzerON();
      handleWearableFall();
    } else if (t == MSG_CANCEL) {
      handleWearableCancel();
    }
  }


  // ----------------------------------------------------------
  // WEARABLE CONNECTION
  // ----------------------------------------------------------

  if (
    millis() - lastWearableMessage >
    WEARABLE_TIMEOUT
  ) {

    wearableConnected =
      false;
  }


  // ----------------------------------------------------------
  // BUZZER
  // ----------------------------------------------------------

  processBuzzer();


  // ----------------------------------------------------------
  // FIREBASE
  // ----------------------------------------------------------

  wifiManager();      // [NEW] WiFi in the background

  portalManager();    // [NEW] opens the setup hotspot when there is no WiFi

  portalLoop();

  contactsManager();  // [NEW] keeps the contact list in sync with the website

  processIncomingSMS();   // [NEW] WIFI / STATUS / SETUP text commands


  firebaseHeartbeat();


  // ----------------------------------------------------------
  // STATUS
  // ----------------------------------------------------------

  static unsigned long lastStatus =
    0;


  if (
    millis() - lastStatus >=
    2000
  ) {

    lastStatus =
      millis();


    Serial.println();

    Serial.println(
      "========== CENTRAL HUB STATUS =========="
    );


    // [NEW] hub MAC in every status block
    Serial.print(
      "Hub MAC: "
    );

    Serial.println(
      WiFi.macAddress()
    );


    Serial.print(
      "Wearable: "
    );


    Serial.println(
      wearableConnected ?
      "CONNECTED" :
      "DISCONNECTED"
    );


    Serial.print(
      "Wearable Acceleration: "
    );


    Serial.print(
      wearableAcceleration,
      2
    );


    Serial.println(
      " G"
    );


    Serial.print(
      "GPS: "
    );


    Serial.println(
      gps.location.isValid() ?
      "FIXED" :
      "NO FIX"
    );


    Serial.print(
      "SIM800L: "
    );


    Serial.println(
      sim800Active ?
      "READY" :
      "NOT READY"
    );


    Serial.print(
      "Firebase: "
    );


    Serial.println(
      firebaseReady() ?
      "CONNECTED" :
      "NOT READY"
    );


    Serial.print(
      "System: "
    );


    if (sosActive) {

      Serial.println(
        "EMERGENCY"
      );

    } else {

      Serial.println(
        "NORMAL"
      );
    }


    Serial.println(
      "========================================"
    );
  }
}