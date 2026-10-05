import { useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { sendJoinRequestEmail } from '../../lib/email';
import { Shield, Cpu, UserCheck, Phone, Eye, EyeOff } from 'lucide-react';
import { formatPhoneNumber } from '../../lib/formatPhone';

interface LoginProps {
  onSignUpComplete?: (status: 'active' | 'pending') => void;
}

export function Login({ onSignUpComplete }: LoginProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [name, setName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [monitoredPersonName, setMonitoredPersonName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  // Field-level error states
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');

    // ============================================================
    // SIGN IN FLOW
    // ============================================================

    if (!isSignUp) {
      setLoading(true);

      try {
        const { auth } = await import('../../lib/firebase');
        const { signInWithEmailAndPassword } = await import('firebase/auth');

        if (email && password) {
          await signInWithEmailAndPassword(
            auth,
            email.trim(),
            password
          );

          console.log('[LOGIN] Login successful');
          console.log('[LOGIN] UID:', auth.currentUser?.uid);
        }
      } catch (err: any) {
        console.error('[LOGIN] Error:', err);
        handleAuthError(err);
      } finally {
        setLoading(false);
      }

      return;
    }

    // ============================================================
    // SIGN UP VALIDATION
    // ============================================================

    if (
      !email ||
      !password ||
      !name ||
      !confirmPassword ||
      !serialNumber.trim() ||
      !monitoredPersonName.trim() ||
      !phoneNumber.trim()
    ) {
      setError('Please fill in all fields.');
      return;
    }

    const nameRegex = /^[a-zA-Z\s]+$/;

    if (!nameRegex.test(name.trim())) {
      setError('Full Name should only contain letters and spaces.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    const phoneRegex = /^09\d{9}$/;

    if (!phoneRegex.test(phoneNumber.trim())) {
      setError(
        'Phone number must contain exactly 11 digits and start with 09 (e.g., 09123456789).'
      );
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    const passwordRegex =
      /^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/;

    if (!passwordRegex.test(password)) {
      setError(
        'Password must be at least 12 characters long, with at least 1 uppercase letter and 1 special character.'
      );
      return;
    }

    if (monitoredPersonName.trim().length < 2) {
      setError(
        'Please enter the full name of the monitored person.'
      );
      return;
    }

    setLoading(true);

    try {
      // ============================================================
      // FIREBASE IMPORTS
      // ============================================================

      const { auth } = await import('../../lib/firebase');

      const {
        db,
        ref,
        getOnce,
        set,
        push
      } = await import('../../lib/db');

      const {
        createUserWithEmailAndPassword,
        updateProfile
      } = await import('firebase/auth');

      const trimmedEmail = email.trim();
      const trimmedName = name.trim();
      const trimmedSerial = serialNumber.trim();
      const trimmedPhone = phoneNumber.trim();
      const trimmedMonitoredName =
        monitoredPersonName.trim();

      // ============================================================
      // STEP 1
      // CREATE FIREBASE AUTH ACCOUNT FIRST
      //
      // IMPORTANT:
      // The previous version tried to read Firebase RTDB BEFORE
      // authenticating the user.
      //
      // With:
      // ".read": "auth != null"
      //
      // those reads were denied.
      //
      // We now authenticate FIRST.
      // ============================================================

      console.log(
        '[SIGNUP] Creating Firebase Authentication account...'
      );

      const userCredential =
        await createUserWithEmailAndPassword(
          auth,
          trimmedEmail,
          password
        );

      const uid = userCredential.user.uid;

      console.log(
        '[SIGNUP] Firebase Authentication successful'
      );

      console.log(
        '[SIGNUP] UID:',
        uid
      );

      // ============================================================
      // STEP 2
      // UPDATE FIREBASE AUTH PROFILE
      // ============================================================

      await updateProfile(
        userCredential.user,
        {
          displayName: trimmedName
        }
      );

      console.log(
        '[SIGNUP] Firebase profile updated'
      );

      // Make sure Firebase Auth is actually available
      if (!auth.currentUser) {
        throw new Error(
          'Firebase Authentication succeeded, but no authenticated user is available.'
        );
      }

      console.log(
        '[SIGNUP] Authenticated UID:',
        auth.currentUser.uid
      );

      // ============================================================
      // STEP 3
      // CHECK ADMIN DEVICE INVENTORY
      //
      // This happens AFTER authentication.
      // ============================================================

      console.log(
        '[SIGNUP] Checking device inventory:',
        trimmedSerial
      );

      const inventoryRef = ref(
        db,
        `admin/inventory/${trimmedSerial}`
      );

      const inventorySnap =
        await getOnce(inventoryRef);

      if (!inventorySnap.exists()) {
        setError(
          'Unrecognized serial number. This device has not been provisioned by the administrator. Please verify the serial number on your CareBeacon device.'
        );

        console.error(
          '[SIGNUP] Device not found in admin inventory'
        );

        return;
      }

      console.log(
        '[SIGNUP] Device found in admin inventory'
      );

      // ============================================================
      // STEP 4
      // CHECK DEVICE RECORD
      // ============================================================

      console.log(
        '[SIGNUP] Checking device record:',
        trimmedSerial
      );

      const deviceRef = ref(
        db,
        `devices/${trimmedSerial}`
      );

      const deviceSnap =
        await getOnce(deviceRef);

      if (!deviceSnap.exists()) {
        setError(
          'Device serial number not recognized. Please check the number and try again.'
        );

        console.error(
          '[SIGNUP] Device record does not exist'
        );

        return;
      }

      const deviceData = deviceSnap.val();

      console.log(
        '[SIGNUP] Device record found:',
        deviceData
      );

      // ============================================================
      // STEP 5
      // CREATE USER DATABASE PROFILE
      // ============================================================

      const now = new Date().toISOString();

      const userRef = ref(
        db,
        `users/${uid}`
      );

      await set(
        userRef,
        {
          name: trimmedName,
          email: trimmedEmail,
          phone: trimmedPhone,
          role: 'caregiver',
          createdAt: now
        }
      );

      console.log(
        '[SIGNUP] User profile created'
      );

      // ============================================================
      // STEP 6
      // CHECK IF DEVICE ALREADY BELONGS TO A FAMILY
      // ============================================================

      if (deviceData.familyId) {

        // ==========================================================
        // EXISTING FAMILY
        // ==========================================================

        const familyId =
          deviceData.familyId;

        console.log(
          '[SIGNUP] Device already belongs to family:',
          familyId
        );

        // ----------------------------------------------------------
        // Create join request
        // ----------------------------------------------------------

        const joinRequestsRef = ref(
          db,
          `families/${familyId}/joinRequests`
        );

        const newRequestRef =
          push(joinRequestsRef);

        await set(
          newRequestRef,
          {
            uid: uid,
            name: trimmedName,
            email: trimmedEmail,
            phone: trimmedPhone,
            status: 'pending',
            createdAt: now
          }
        );

        console.log(
          '[SIGNUP] Join request created'
        );

        // ----------------------------------------------------------
        // Link user to family
        // ----------------------------------------------------------

        const userFamilyRef = ref(
          db,
          `users/${uid}/familyId`
        );

        await set(
          userFamilyRef,
          familyId
        );

        const userStatusRef = ref(
          db,
          `users/${uid}/accessStatus`
        );

        await set(
          userStatusRef,
          'pending'
        );

        console.log(
          '[SIGNUP] User linked to existing family'
        );

        // ----------------------------------------------------------
        // Admin registration queue
        // ----------------------------------------------------------

        const queueRef = ref(
          db,
          'admin/registrationQueue'
        );

        const newQueueRef =
          push(queueRef);

        await set(
          newQueueRef,
          {
            familyId: familyId,
            caregiverUid: uid,
            caregiverName: trimmedName,
            caregiverEmail: trimmedEmail,
            deviceSerialNumber: trimmedSerial,
            monitoredPersonName:
              '(Joining existing family)',
            createdAt: now,
            status: 'pending_review'
          }
        );

        console.log(
          '[SIGNUP] Registration queue created'
        );

        // ----------------------------------------------------------
        // Email notification
        // ----------------------------------------------------------

        try {
          await sendJoinRequestEmail(
            trimmedName,
            trimmedSerial
          );

          console.log(
            '[SIGNUP] Join request email sent'
          );
        } catch (emailError) {
          console.error(
            '[SIGNUP] Email notification failed:',
            emailError
          );
        }

        // ----------------------------------------------------------
        // Complete
        // ----------------------------------------------------------

        setInfo(
          'A request to join this family has been sent to the existing caregivers for approval. You will gain access once approved.'
        );

        if (onSignUpComplete) {
          onSignUpComplete('pending');
        }

        console.log(
          '[SIGNUP] Signup completed - pending approval'
        );

      } else {

        // ==========================================================
        // NEW FAMILY
        // ==========================================================

        console.log(
          '[SIGNUP] Device has no family.'
        );

        console.log(
          '[SIGNUP] Creating new family...'
        );

        // ----------------------------------------------------------
        // Create family
        // ----------------------------------------------------------

        const familiesRef = ref(
          db,
          'families'
        );

        const newFamilyRef =
          push(familiesRef);

        const familyId =
          newFamilyRef.key;

        if (!familyId) {
          throw new Error(
            'Failed to generate family ID.'
          );
        }

        console.log(
          '[SIGNUP] New family ID:',
          familyId
        );

        // ----------------------------------------------------------
        // Create family record
        // ----------------------------------------------------------

        await set(
          newFamilyRef,
          {
            monitoredPerson: {
              name: trimmedMonitoredName
            },

            deviceId: trimmedSerial,

            deviceSerialNumber:
              trimmedSerial,

            caregivers: {
              [uid]: {
                name: trimmedName,
                email: trimmedEmail,
                phone: trimmedPhone,
                role: 'primary',
                joinedAt: now
              }
            },

            createdAt: now,

            status: 'active'
          }
        );

        console.log(
          '[SIGNUP] Family created'
        );

        // ----------------------------------------------------------
        // Link device to family
        // ----------------------------------------------------------

        const deviceFamilyRef = ref(
          db,
          `devices/${trimmedSerial}/familyId`
        );

        await set(
          deviceFamilyRef,
          familyId
        );

        console.log(
          '[SIGNUP] Device linked to family'
        );

        // ----------------------------------------------------------
        // Link user to family
        // ----------------------------------------------------------

        const userFamilyRef = ref(
          db,
          `users/${uid}/familyId`
        );

        await set(
          userFamilyRef,
          familyId
        );

        const userStatusRef = ref(
          db,
          `users/${uid}/accessStatus`
        );

        await set(
          userStatusRef,
          'active'
        );

        console.log(
          '[SIGNUP] User linked to family'
        );

        // ----------------------------------------------------------
        // Admin registration queue
        // ----------------------------------------------------------

        const queueRef = ref(
          db,
          'admin/registrationQueue'
        );

        const newQueueRef =
          push(queueRef);

        await set(
          newQueueRef,
          {
            familyId: familyId,
            caregiverUid: uid,
            caregiverName: trimmedName,
            caregiverEmail: trimmedEmail,
            deviceSerialNumber: trimmedSerial,
            monitoredPersonName:
              trimmedMonitoredName,
            createdAt: now,
            status: 'pending_review'
          }
        );

        console.log(
          '[SIGNUP] Admin registration queue created'
        );

        // ----------------------------------------------------------
        // Complete
        // ----------------------------------------------------------

        if (onSignUpComplete) {
          onSignUpComplete('active');
        }

        console.log(
          '[SIGNUP] Signup completed successfully'
        );
      }

    } catch (err: any) {

      console.error(
        '[SIGNUP] ERROR:',
        err
      );

      console.error(
        '[SIGNUP] Error code:',
        err?.code
      );

      console.error(
        '[SIGNUP] Error message:',
        err?.message
      );

      handleAuthError(err);

    } finally {
      setLoading(false);
    }
  };

  const handleAuthError = (err: any) => {
    console.error(
      'Authentication Error:',
      err
    );

    let errorMessage =
      'An error occurred during authentication. Please try again.';

    if (err.code) {
      switch (err.code) {

        case 'auth/invalid-email':
          errorMessage =
            'Please enter a valid email address.';
          break;

        case 'auth/user-disabled':
          errorMessage =
            'This account has been disabled. Please contact support.';
          break;

        case 'auth/user-not-found':
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
          errorMessage =
            'Incorrect email or password. Please try again.';
          break;

        case 'auth/email-already-in-use':
          errorMessage =
            'An account with this email already exists. Try signing in instead.';
          break;

        case 'auth/weak-password':
          errorMessage =
            'Your password is too weak. Please use at least 6 characters.';
          break;

        case 'auth/network-request-failed':
          errorMessage =
            'Network error. Please check your internet connection and try again.';
          break;

        case 'auth/too-many-requests':
          errorMessage =
            'Too many failed attempts. Please try again later.';
          break;

        default:
          errorMessage =
            err.message || errorMessage;
      }

    } else if (err.message) {

      errorMessage =
        err.message;
    }

    setError(errorMessage);
  };

  return (
    <div className="size-full flex flex-col bg-background">

      {/* Top Header */}
      <header className="border-b border-border bg-card">
        <div className="flex items-center gap-3 px-4 md:px-8 py-4">

          <div className="flex items-center justify-center size-10 bg-primary/10 rounded-xl text-primary">
            <Shield
              className="size-6"
              strokeWidth={2}
            />
          </div>

          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              CareBeacon
            </h1>
          </div>

        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col items-center">

        <div
          className={`w-full transition-all duration-300 ${
            isSignUp
              ? 'max-w-2xl'
              : 'max-w-md'
          } mt-4 md:mt-8`}
        >

          {/* Header Text */}
          <div className="text-center mb-6">

            <h2 className="text-2xl font-semibold text-foreground">
              {isSignUp
                ? 'Create an Account'
                : 'Welcome Back'}
            </h2>

            <p className="text-sm text-muted-foreground mt-1">
              {isSignUp
                ? 'Register and link your CareBeacon device.'
                : 'Sign in to monitor your linked devices.'}
            </p>

          </div>

          {/* Login/Signup Card */}
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">

            {/* Toggle Tabs */}
            <div className="flex gap-2 mb-6 p-1 bg-muted rounded-xl">

              <button
                type="button"
                onClick={() => {
                  setIsSignUp(false);
                  setError('');
                  setInfo('');
                  setEmailError('');
                  setPasswordError('');
                  setPhoneError('');
                  setNameError('');
                  setConfirmError('');
                }}
                className={`flex-1 py-2.5 rounded-lg font-medium transition-all duration-200 text-sm ${
                  !isSignUp
                    ? 'bg-card text-foreground shadow-sm border border-border'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Sign In
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSignUp(true);
                  setError('');
                  setInfo('');
                  setEmailError('');
                  setPasswordError('');
                  setPhoneError('');
                  setNameError('');
                  setConfirmError('');
                }}
                className={`flex-1 py-2.5 rounded-lg font-medium transition-all duration-200 text-sm ${
                  isSignUp
                    ? 'bg-card text-foreground shadow-sm border border-border'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Sign Up
              </button>

            </div>

            {error && (
              <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">
                {error}
              </div>
            )}

            {info && (
              <div className="mb-4 p-3 bg-primary/10 border border-primary/20 rounded-xl text-primary text-sm">
                {info}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="space-y-4"
            >

              {/* Form Fields */}
              <div
                className={
                  isSignUp
                    ? "grid grid-cols-1 md:grid-cols-2 gap-6"
                    : "space-y-4"
                }
              >

                {/* Column 1 */}
                <div className="space-y-4">

                  {/* Full Name */}
                  {isSignUp && (
                    <div className="space-y-2">

                      <label className="text-sm font-medium text-foreground">
                        Full Name
                      </label>

                      <input
                        type="text"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);

                          const val =
                            e.target.value;

                          if (
                            val.trim() &&
                            !/^[a-zA-Z\s]+$/.test(
                              val.trim()
                            )
                          ) {
                            setNameError(
                              'Full Name should only contain letters and spaces.'
                            );
                          } else {
                            setNameError('');
                          }
                        }}
                        className="w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors text-sm"
                        placeholder="Juan Dela Cruz"
                        required={isSignUp}
                      />

                      {nameError && (
                        <p className="text-xs text-destructive mt-1">
                          {nameError}
                        </p>
                      )}

                    </div>
                  )}

                  {/* Email */}
                  <div className="space-y-2">

                    <label className="text-sm font-medium text-foreground">
                      Email Address
                    </label>

                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);

                        const val =
                          e.target.value;

                        if (
                          val.trim() &&
                          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                            val.trim()
                          )
                        ) {
                          setEmailError(
                            'Please enter a valid email address.'
                          );
                        } else {
                          setEmailError('');
                        }
                      }}
                      className="w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors text-sm"
                      placeholder="caregiver@example.com"
                      required
                    />

                    {emailError && (
                      <p className="text-xs text-destructive mt-1">
                        {emailError}
                      </p>
                    )}

                  </div>

                  {/* Phone */}
                  {isSignUp && (
                    <div className="space-y-2">

                      <label className="text-sm font-medium text-foreground flex items-center gap-1.5">

                        <Phone className="size-3.5" />

                        Phone Number

                      </label>

                      <input
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => {
                          setPhoneNumber(
                            e.target.value
                          );

                          const val =
                            e.target.value;

                          if (
                            val.trim() &&
                            !/^09\d{9}$/.test(
                              val.trim()
                            )
                          ) {
                            setPhoneError(
                              'Phone number must contain exactly 11 digits and start with 09.'
                            );
                          } else {
                            setPhoneError('');
                          }
                        }}
                        className="w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors text-sm"
                        placeholder="09123456789"
                        required={isSignUp}
                      />

                      {phoneError && (
                        <p className="text-xs text-destructive mt-1">
                          {phoneError}
                        </p>
                      )}

                    </div>
                  )}

                  {/* Password */}
                  <div className="space-y-2">

                    <label className="text-sm font-medium text-foreground">
                      Password
                    </label>

                    <div className="relative">

                      <input
                        type={
                          showPassword
                            ? "text"
                            : "password"
                        }
                        value={password}
                        onChange={(e) => {
                          setPassword(
                            e.target.value
                          );

                          const val =
                            e.target.value;

                          if (
                            isSignUp &&
                            val &&
                            !/^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/.test(
                              val
                            )
                          ) {
                            setPasswordError(
                              'Password must be at least 12 chars, with 1 uppercase and 1 special char.'
                            );
                          } else {
                            setPasswordError('');
                          }
                        }}
                        className="w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors text-sm pr-10"
                        placeholder="••••••••"
                        required
                      />

                      <button
                        type="button"
                        onClick={() =>
                          setShowPassword(
                            !showPassword
                          )
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPassword ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>

                    </div>

                    {passwordError && (
                      <p className="text-xs text-destructive mt-1">
                        {passwordError}
                      </p>
                    )}

                  </div>

                  {/* Confirm Password */}
                  {isSignUp && (
                    <div className="space-y-2">

                      <label className="text-sm font-medium text-foreground">
                        Confirm Password
                      </label>

                      <div className="relative">

                        <input
                          type={
                            showConfirmPassword
                              ? "text"
                              : "password"
                          }
                          value={confirmPassword}
                          onChange={(e) => {
                            setConfirmPassword(
                              e.target.value
                            );

                            if (
                              e.target.value &&
                              e.target.value !==
                                password
                            ) {
                              setConfirmError(
                                'Passwords do not match.'
                              );
                            } else {
                              setConfirmError('');
                            }
                          }}
                          className="w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors text-sm pr-10"
                          placeholder="••••••••"
                          required={isSignUp}
                        />

                        <button
                          type="button"
                          onClick={() =>
                            setShowConfirmPassword(
                              !showConfirmPassword
                            )
                          }
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </button>

                      </div>

                      {confirmError && (
                        <p className="text-xs text-destructive mt-1">
                          {confirmError}
                        </p>
                      )}

                    </div>
                  )}

                </div>

                {/* Column 2 */}
                {isSignUp && (
                  <div className="space-y-4">

                    <div className="p-4 bg-primary/5 border border-primary/10 rounded-xl space-y-4">

                      <div className="flex items-center gap-2 mb-2">

                        <Cpu className="size-4 text-primary" />

                        <h3 className="text-sm font-semibold text-primary">
                          Device Registration
                        </h3>

                      </div>

                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Link your CareBeacon device to activate fall detection and location tracking.
                      </p>

                      {/* Serial Number */}
                      <div className="space-y-2 pt-2">

                        <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                          Device Serial Number
                        </label>

                        <input
                          type="text"
                          value={serialNumber}
                          onChange={(e) =>
                            setSerialNumber(
                              e.target.value
                            )
                          }
                          className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors text-sm font-mono tracking-wider"
                          placeholder="CB-XXXX-XXXX"
                          required={isSignUp}
                        />

                        <p className="text-[10px] text-muted-foreground">
                          Found on the back of your CareBeacon device.
                        </p>

                      </div>

                      {/* Monitored Person */}
                      <div className="space-y-2 pt-2">

                        <label className="text-sm font-medium text-foreground flex items-center gap-1.5">

                          <UserCheck className="size-3.5" />

                          Monitored Person's Name

                        </label>

                        <input
                          type="text"
                          value={monitoredPersonName}
                          onChange={(e) =>
                            setMonitoredPersonName(
                              e.target.value
                            )
                          }
                          className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors text-sm"
                          placeholder="Name of the elderly user"
                          required={isSignUp}
                        />

                      </div>

                    </div>

                  </div>
                )}

              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium transition-colors disabled:opacity-70 disabled:pointer-events-none"
              >
                {loading
                  ? 'Processing...'
                  : (
                    isSignUp
                      ? 'Create Account & Link Device'
                      : 'Access Dashboard'
                  )}
              </button>

            </form>

          </div>

        </div>

      </div>

    </div>
  );
}
