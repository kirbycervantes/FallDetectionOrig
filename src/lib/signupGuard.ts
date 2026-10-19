/**
 * Firebase signs the new user in the moment the account is created, but the sign-up is only valid
 * after the MAC address, phone number and the rest were checked. While `active` is true the app
 * ignores that sign-in, so the dashboard never opens for a sign-up that is about to be refused.
 */
export const signupGuard = { active: false };
