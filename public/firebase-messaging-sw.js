// Scripts for firebase and firebase messaging
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

// Initialize the Firebase app in the service worker by passing in the
// messagingSenderId.
// Note: We would ideally inject this during build, but for now we fallback to the known ID
const firebaseConfig = {
  apiKey: "AIzaSyBtHKQT_R6rWLW2oN5OLt0CQOKkSlDnQN8",
  authDomain: "clone-91070.firebaseapp.com",
  databaseURL: "https://clone-91070-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "clone-91070",
  storageBucket: "clone-91070.firebasestorage.app",
  messagingSenderId: "980668037537",
  appId: "1:980668037537:web:07090fbcc33f145394f3e0"
};

firebase.initializeApp(firebaseConfig);

// Retrieve an instance of Firebase Messaging so that it can handle background messages.
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification?.title || 'CareBeacon Alert';
  const notificationOptions = {
    body: payload.notification?.body || 'A new event requires your attention.',
    icon: '/icon-192.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
