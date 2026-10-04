setLoading(true);

try {
  const { auth } = await import('../../lib/firebase');
  const { db, ref, getOnce, set, push } = await import('../../lib/db');

  const {
    createUserWithEmailAndPassword,
    updateProfile,
  } = await import('firebase/auth');

  const trimmedEmail = email.trim();
  const trimmedName = name.trim();
  const trimmedSerial = serialNumber.trim();
  const trimmedPhone = phoneNumber.trim();
  const trimmedMonitoredName = monitoredPersonName.trim();

  // ============================================================
  // STEP 1 — CREATE FIREBASE AUTH ACCOUNT FIRST
  // ============================================================

  const userCredential = await createUserWithEmailAndPassword(
    auth,
    trimmedEmail,
    password
  );

  const user = userCredential.user;
  const uid = user.uid;

  await updateProfile(user, {
    displayName: trimmedName,
  });

  console.log('Firebase Auth account created:', uid);

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
    // Remove the Auth account because the device is invalid
    await user.delete();

    setError(
      'Unrecognized serial number. This device has not been provisioned by the administrator.'
    );

    return;
  }

  console.log('Inventory validated:', trimmedSerial);

  // ============================================================
  // STEP 3 — CHECK DEVICE RECORD
  // ============================================================

  const deviceRef = ref(
    db,
    `devices/${trimmedSerial}`
  );

  const deviceSnap = await getOnce(deviceRef);

  if (!deviceSnap.exists()) {
    // Remove the Auth account because the device does not exist
    await user.delete();

    setError(
      'Device serial number not recognized. Please check the number and try again.'
    );

    return;
  }

  const deviceData = deviceSnap.val();

  console.log('Device validated:', trimmedSerial);
  console.log('Device data:', deviceData);

  // ============================================================
  // STEP 4 — CREATE USER PROFILE
  // ============================================================

  const userRef = ref(
    db,
    `users/${uid}`
  );

  await set(userRef, {
    name: trimmedName,
    email: trimmedEmail,
    phone: trimmedPhone,
    role: 'caregiver',
    createdAt: now,
  });

  console.log('User profile created:', uid);

  // ============================================================
  // STEP 5 — CHECK IF DEVICE ALREADY HAS A FAMILY
  // ============================================================

  if (deviceData.familyId) {
    // ==========================================================
    // EXISTING FAMILY — CREATE JOIN REQUEST
    // ==========================================================

    const familyId = deviceData.familyId;

    console.log(
      'Existing family detected:',
      familyId
    );

    // ----------------------------------------------------------
    // Create join request
    // ----------------------------------------------------------

    const joinRequestsRef = ref(
      db,
      `families/${familyId}/joinRequests`
    );

    const newRequestRef = push(
      joinRequestsRef
    );

    await set(newRequestRef, {
      uid: uid,
      name: trimmedName,
      email: trimmedEmail,
      phone: trimmedPhone,
      status: 'pending',
      createdAt: now,
    });

    console.log(
      'Join request created:',
      newRequestRef.key
    );

    // ----------------------------------------------------------
    // Link user to family
    // ----------------------------------------------------------

    await set(
      ref(db, `users/${uid}/familyId`),
      familyId
    );

    await set(
      ref(db, `users/${uid}/accessStatus`),
      'pending'
    );

    console.log(
      'User linked to family with pending status.'
    );

    // ----------------------------------------------------------
    // Add registration request to admin queue
    // ----------------------------------------------------------

    const queueRef = ref(
      db,
      'admin/registrationQueue'
    );

    const newQueueRef = push(queueRef);

    await set(newQueueRef, {
      familyId: familyId,
      caregiverUid: uid,
      caregiverName: trimmedName,
      caregiverEmail: trimmedEmail,
      deviceSerialNumber: trimmedSerial,
      monitoredPersonName: '(Joining existing family)',
      createdAt: now,
      status: 'pending_review',
    });

    console.log(
      'Registration added to admin queue.'
    );

    // ----------------------------------------------------------
    // Send email notification
    // ----------------------------------------------------------

    try {
      sendJoinRequestEmail(
        trimmedName,
        trimmedSerial
      );
    } catch (emailError) {
      console.warn(
        'Join request email failed:',
        emailError
      );
    }

    setInfo(
      'Your request to join this family has been sent for approval.'
    );

    if (onSignUpComplete) {
      onSignUpComplete('pending');
    }

    return;
  }

  // ============================================================
  // STEP 6 — CREATE NEW FAMILY
  // ============================================================

  console.log(
    'No family found. Creating new family.'
  );

  const familiesRef = ref(
    db,
    'families'
  );

  const newFamilyRef = push(
    familiesRef
  );

  const familyId = newFamilyRef.key;

  if (!familyId) {
    throw new Error(
      'Could not create family ID.'
    );
  }

  await set(newFamilyRef, {
    monitoredPerson: {
      name: trimmedMonitoredName,
    },

    deviceId: trimmedSerial,

    deviceSerialNumber: trimmedSerial,

    caregivers: {
      [uid]: {
        name: trimmedName,
        email: trimmedEmail,
        phone: trimmedPhone,
        role: 'primary',
        joinedAt: now,
      },
    },

    createdAt: now,

    status: 'active',
  });

  console.log(
    'Family created:',
    familyId
  );

  // ============================================================
  // STEP 7 — LINK DEVICE TO FAMILY
  // ============================================================

  await set(
    ref(
      db,
      `devices/${trimmedSerial}/familyId`
    ),
    familyId
  );

  console.log(
    'Device linked to family.'
  );

  // ============================================================
  // STEP 8 — LINK USER TO FAMILY
  // ============================================================

  await set(
    ref(
      db,
      `users/${uid}/familyId`
    ),
    familyId
  );

  await set(
    ref(
      db,
      `users/${uid}/accessStatus`
    ),
    'active'
  );

  console.log(
    'User linked to family.'
  );

  // ============================================================
  // STEP 9 — ADD REGISTRATION TO ADMIN QUEUE
  // ============================================================

  const queueRef = ref(
    db,
    'admin/registrationQueue'
  );

  const newQueueRef = push(
    queueRef
  );

  await set(newQueueRef, {
    familyId: familyId,
    caregiverUid: uid,
    caregiverName: trimmedName,
    caregiverEmail: trimmedEmail,
    deviceSerialNumber: trimmedSerial,
    monitoredPersonName: trimmedMonitoredName,
    createdAt: now,
    status: 'pending_review',
  });

  console.log(
    'Registration completed successfully.'
  );

  setInfo(
    'Account created successfully. Your CareBeacon device has been registered.'
  );

  if (onSignUpComplete) {
    onSignUpComplete('active');
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
