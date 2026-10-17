import { 
  ref as fbRef, 
  onValue as fbOnValue, 
  onChildAdded as fbOnChildAdded,
  push as fbPush, 
  set as fbSet, 
  update as fbUpdate, 
  remove as fbRemove, 
  get as fbGet,
  runTransaction as fbRunTransaction
} from 'firebase/database';
import { db as firebaseDb } from './firebase';

export const db = firebaseDb;

export const ref = (database: any, path: string) => {
  return fbRef(database, path);
};

export const onValue = (reference: any, callback: (snapshot: any) => void, errorCallback?: (error: Error) => void) => {
  if (errorCallback) {
    return fbOnValue(reference, callback, errorCallback);
  }
  return fbOnValue(reference, callback);
};

export const onChildAdded = (reference: any, callback: (snapshot: any) => void, errorCallback?: (error: Error) => void) => {
  if (errorCallback) {
    return fbOnChildAdded(reference, callback, errorCallback);
  }
  return fbOnChildAdded(reference, callback);
};

export const push = (reference: any, value?: any) => {
  return value !== undefined ? fbPush(reference, value) : fbPush(reference);
};

export const set = (reference: any, value: any) => {
  return fbSet(reference, value);
};

export const update = (reference: any, value: any) => {
  return fbUpdate(reference, value);
};

export const remove = (reference: any) => {
  return fbRemove(reference);
};

export const getOnce = async (reference: any) => {
  return fbGet(reference);
};

export const runTransaction = (reference: any, updater: (current: any) => any) => {
  return fbRunTransaction(reference, updater);
};
