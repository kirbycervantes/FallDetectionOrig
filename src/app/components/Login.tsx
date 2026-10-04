setLoading(true);

try {
  const { auth } = await import('../../lib/firebase');
  const { db, ref, getOnce, set, push } = await import('../../lib/db');

  const trimmedSerial = serialNumber.trim();

  // ============================================================
  // STEP 1 — CREATE FIREBASE AUTH ACCOUNT FIRST
  // ============================================================

  const {
    createUserWithEmailAndPassword,
    updateProfile
  } = await import('firebase/auth');

  const userCredential = await createUserWithEmailAndPassword(
    auth,
    email.trim(),
    password
  );

  const uid = userCredential.user.uid;

  await updateProfile(userCredential.user, {
    displayName: name.trim()
  });

  console.log('Account created:', uid);

  const now = new Date().toISOString();

  // ============================================================
  // STEP 2 — CHECK DEVICE INVENTORY
  // ============================================================

  const inventoryRef = ref(
    db,
    `admin/inventory/${trimmedSerial}`
  );

  const inventorySnap = await getOnce(inventoryRef);

  if (!inventorySnap.exists()) {
    await userCredential.user.delete();

    setError(
      'Unrecognized serial number. This device has not been provisioned by the administrator.'
    );

    setLoading(false);
    return;
  }

  // ============================================================
  // STEP 3 — CHECK DEVICE
  // ============================================================

  const deviceRef = ref(
    db,
    `devices/${trimmedSerial}`
  );

  const deviceSnap = await getOnce(deviceRef);

  if (!deviceSnap.exists()) {
    await userCredential.user.delete();

    setError(
      'Device serial number not recognized. Please check the number and try again.'
    );

    setLoading(false);
    return;
  }

  const deviceData = deviceSnap.val();

  console.log('Device validated:', trimmedSerial);

  // ============================================================
  // STEP 4 — CREATE USER PROFILE
  // ============================================================

  const userRef = ref(db, `users/${uid}`);

  await set(userRef, {
    name: name.trim(),
    email: email.trim(),
    phone: phoneNumber.trim(),
    role: 'caregiver',
    createdAt: now
  });

  console.log('User profile created:', uid);

  // ============================================================
  // STEP 5 — EXISTING FAMILY
  // ============================================================

  if (deviceData.familyId) {

    const familyId = deviceData.familyId;

    const joinRequestsRef = ref(
      db,
      `families/${familyId}/joinRequests`
    );

    const newRequestRef = push(joinRequestsRef);

    await set(newRequestRef, {
      uid: uid,
      name: name.trim(),
      email: email.trim(),
      phone: phoneNumber.trim(),
      status: 'pending',
      createdAt: now
    });

    await set(
      ref(db, `users/${uid}/familyId`),
      familyId
    );

    await set(
      ref(db, `users/${uid}/accessStatus`),
      'pending'
    );

    // Registration queue

    const queueRef = ref(
      db,
      'admin/registrationQueue'
    );

    const newQueueRef = push(queueRef);

    await set(newQueueRef, {
      familyId: familyId,
      caregiverUid: uid,
      caregiverName: name.trim(),
      caregiverEmail: email.trim(),
      deviceSerialNumber: trimmedSerial,
      monitoredPersonName: '(Joining existing family)',
      createdAt: now,
      status: 'pending_review'
    });

    sendJoinRequestEmail(
      name.trim(),
      trimmedSerial
    );

    setInfo(
      'Your request to join this family has been sent for approval.'
    );

    if (onSignUpComplete) {
      onSignUpComplete('pending');
    }

  } else {

    // ==========================================================
    // STEP 6 — CREATE NEW FAMILY
    // ==========================================================

    const familiesRef = ref(db, 'families');

    const newFamilyRef = push(familiesRef);

    const familyId = newFamilyRef.key;

    if (!familyId) {
      throw new Error('Could not create family ID.');
    }

    await set(newFamilyRef, {

      monitoredPerson: {
        name: monitoredPersonName.trim()
      },

      deviceId: trimmedSerial,

      deviceSerialNumber: trimmedSerial,

      caregivers: {
        [uid]: {
          name: name.trim(),
          email: email.trim(),
          phone: phoneNumber.trim(),
          role: 'primary',
          joinedAt: now
        }
      },

      createdAt: now,

      status: 'active'
    });

    console.log('Family created:', familyId);

    // ==========================================================
    // STEP 7 — LINK DEVICE
    // ==========================================================

    await set(
      ref(db, `devices/${trimmedSerial}/familyId`),
      familyId
    );

    // ==========================================================
    // STEP 8 — LINK USER
    // ==========================================================

    await set(
      ref(db, `users/${uid}/familyId`),
      familyId
    );

    await set(
      ref(db, `users/${uid}/accessStatus`),
      'active'
    );

    // ==========================================================
    // STEP 9 — ADMIN REGISTRATION QUEUE
    // ==========================================================

    const queueRef = ref(
      db,
      'admin/registrationQueue'
    );

    const newQueueRef = push(queueRef);

    await set(newQueueRef, {
      familyId: familyId,
      caregiverUid: uid,
      caregiverName: name.trim(),
      caregiverEmail: email.trim(),
      deviceSerialNumber: trimmedSerial,
      monitoredPersonName: monitoredPersonName.trim(),
      createdAt: now,
      status: 'pending_review'
    });

    console.log('Registration completed.');

    if (onSignUpComplete) {
      onSignUpComplete('active');
    }
  }

} catch (err: any) {

  console.error(
    'Registration error:',
    err
  );

  handleAuthError(err);

} finally {

  setLoading(false);

}
