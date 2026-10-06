import React, { useState, useEffect } from 'react';
import { Phone, PhoneOff, AlertCircle } from 'lucide-react';
import { formatPhoneNumber } from '../../lib/formatPhone';
import { db, ref, set, onValue } from '../../lib/db';

interface DeviceAudioProps {
  deviceId: string;
}

export function DeviceAudio({ deviceId }: DeviceAudioProps) {
  const [targetNumber, setTargetNumber] = useState('');
  const [callStatus, setCallStatus] = useState<'idle' | 'requested' | 'dialing' | 'in-call' | 'ended' | 'failed'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    // Listen for call status updates from the device
    const statusRef = ref(db, `devices/${deviceId}/callRequest/status`);
    const unsubscribe = onValue(statusRef, (snapshot) => {
      const status = snapshot.val();
      if (status) {
        setCallStatus(status as any);
      }
    });

    return () => unsubscribe();
  }, [deviceId]);

  const requestCall = async () => {
    if (!targetNumber) {
      setErrorMessage('Please enter a phone number to call.');
      return;
    }
    
    try {
      setErrorMessage('');
      setCallStatus('requested');
      
      const callRequestRef = ref(db, `devices/${deviceId}/callRequest`);
      await set(callRequestRef, {
        targetNumber,
        timestamp: Date.now(),
        status: 'requested'
      });
    } catch (error) {
      console.error('Error requesting call:', error);
      setErrorMessage('Failed to send call request to device.');
      setCallStatus('idle');
    }
  };

  const endCall = async () => {
    try {
      const callRequestRef = ref(db, `devices/${deviceId}/callRequest`);
      await set(callRequestRef, {
        targetNumber,
        timestamp: Date.now(),
        status: 'ended'
      });
      setCallStatus('ended');
    } catch (error) {
      console.error('Error ending call:', error);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
      <h3 className="text-lg font-semibold mb-4 text-foreground flex items-center gap-2">
        <Phone className="size-5 text-primary" />
       SMS Alert
      </h3>
      
      <p className="text-sm text-muted-foreground mb-6">
        Request the device to make a standard cellular call to your phone. Ensure you have cellular signal.
      </p>

      {errorMessage && (
        <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-lg flex items-center gap-2">
          <AlertCircle className="size-4" />
          {errorMessage}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">Your Phone Number</label>
          <input 
            type="tel"
            placeholder="+63 917 123 4567"
            value={targetNumber || '+63'}
            onChange={(e) => setTargetNumber(formatPhoneNumber(e.target.value))}
            disabled={callStatus !== 'idle' && callStatus !== 'ended' && callStatus !== 'failed'}
            className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div className="flex items-center gap-4">
          {callStatus === 'idle' || callStatus === 'ended' || callStatus === 'failed' ? (
            <button
              onClick={requestCall}
              className="flex-1 bg-primary text-primary-foreground py-3 px-4 rounded-xl font-medium hover:bg-primary/90 transition flex items-center justify-center gap-2"
            >
              <Phone className="size-5" />
              Send SMS
            </button>
          ) : (
            <button
              onClick={endCall}
              className="flex-1 bg-destructive text-destructive-foreground py-3 px-4 rounded-xl font-medium hover:bg-destructive/90 transition flex items-center justify-center gap-2"
            >
              <PhoneOff className="size-5" />
              End Call / Cancel
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 pt-6 border-t border-border flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Device Status</span>
        <div className="flex items-center gap-2">
          <div className={`size-2.5 rounded-full ${
            callStatus === 'in-call' ? 'bg-success animate-pulse' :
            (callStatus === 'requested' || callStatus === 'dialing') ? 'bg-warning animate-bounce' :
            callStatus === 'failed' ? 'bg-destructive' :
            'bg-muted'
          }`}></div>
          <span className={`font-medium capitalize ${
            callStatus === 'in-call' ? 'text-success' :
            (callStatus === 'requested' || callStatus === 'dialing') ? 'text-warning' :
            callStatus === 'failed' ? 'text-destructive' :
            'text-muted-foreground'
          }`}>
            {callStatus.replace('-', ' ')}
          </span>
        </div>
      </div>
    </div>
  );
}
