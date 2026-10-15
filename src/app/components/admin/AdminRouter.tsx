import { Routes, Route, Navigate } from 'react-router';
import { AdminDashboard } from './AdminDashboard';
import { AdminFamilies } from './AdminFamilies';
import { AdminReview } from './AdminReview';
import { AdminDevices } from './AdminDevices';
import { AdminIncidents } from './AdminIncidents';
import { AdminAlertDelivery } from './AdminAlertDelivery';
import { AdminSettings } from './AdminSettings';
import { AdminAnalytics } from './AdminAnalytics';
import { AdminImpersonate } from './AdminImpersonate';

export function AdminRouter() {
  return (
    <Routes>
      <Route path="/" element={<AdminDashboard />} />
      <Route path="/families" element={<AdminFamilies />} />
      <Route path="/review" element={<AdminReview />} />
      <Route path="/devices" element={<AdminDevices />} />
      <Route path="/incidents" element={<AdminIncidents />} />
      <Route path="/alert-delivery" element={<AdminAlertDelivery />} />
      <Route path="/settings" element={<AdminSettings />} />
      <Route path="/analytics" element={<AdminAnalytics />} />
      <Route path="/family/:id" element={<AdminImpersonate />} />
      {/* Fallback for unbuilt pages */}
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
