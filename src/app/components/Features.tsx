import { Smartphone, MapPin, XCircle, Monitor, Bell, Activity } from 'lucide-react';

const features = [
  {
    icon: Activity,
    title: 'Automatic Fall Detection',
    description: 'MPU6050 sensor detects falls using accelerometer and gyroscope data with threshold-based algorithm achieving ~95% accuracy.',
    color: 'bg-blue-500',
  },
  {
    icon: Smartphone,
    title: 'SMS Alerts',
    description: 'Instant SMS notifications sent to emergency contacts via GSM module with GPS coordinates included.',
    color: 'bg-green-500',
  },
  {
    icon: XCircle,
    title: 'Cancel Button',
    description: 'A 5-second countdown on the wearable lets the user press Cancel to stop a false alarm before any SMS is sent.',
    color: 'bg-purple-500',
  },
  {
    icon: MapPin,
    title: 'GPS Tracking',
    description: 'NEO-7M GPS module provides accurate real-time location tracking for faster emergency response.',
    color: 'bg-red-500',
  },
  {
    icon: Monitor,
    title: 'Web Dashboard',
    description: 'Web-based monitoring platform displays real-time location, fall event history, and system status.',
    color: 'bg-orange-500',
  },
  {
    icon: Bell,
    title: 'Multi-Contact Alerts',
    description: 'The SMS alert goes to every emergency contact registered on the website, so no one is left out.',
    color: 'bg-teal-500',
  },
];

export function Features() {
  return (
    <div className="bg-gray-50 py-20">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <h2 className="text-3xl lg:text-4xl mb-6">Key Features</h2>
          <p className="text-lg text-gray-600">
            A comprehensive IoT solution combining hardware sensors, GSM communication, 
            and cloud monitoring for complete elderly care.
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div 
                key={index} 
                className="bg-white rounded-xl p-8 shadow-sm hover:shadow-md transition"
              >
                <div className={`inline-flex p-3 ${feature.color} text-white rounded-lg mb-4`}>
                  <Icon className="size-6" />
                </div>
                <h3 className="text-xl mb-3">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
