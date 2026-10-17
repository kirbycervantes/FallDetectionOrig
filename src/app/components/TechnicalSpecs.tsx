import { ImageWithFallback } from './figma/ImageWithFallback';
import { Cpu, Wifi, Radio, Navigation } from 'lucide-react';

const components = [
  {
    icon: Cpu,
    name: 'ESP32 Microcontroller',
    description: 'Dual-core processor with Wi-Fi and Bluetooth connectivity',
  },
  {
    icon: Navigation,
    name: 'MPU6050 Sensor',
    description: '3-axis accelerometer & gyroscope for motion detection',
  },
  {
    icon: Wifi,
    name: 'NEO-7M GPS Module',
    description: 'Real-time location tracking and positioning',
  },
  {
    icon: Radio,
    name: 'SIM800L GSM Module',
    description: 'SMS alerts to the registered emergency contacts',
  },
];

const objectives = [
  'Design wearable fall-detection prototype with MPU6050, GPS, and GSM integration',
  'Implement fall detection algorithm distinguishing falls from daily activities',
  'Send SMS notifications with GPS location to emergency contacts',
  'Let the wearer cancel a false alarm within a 5-second window',
  'Develop web-based monitoring dashboard with real-time location display',
  'Achieve fall detection accuracy above 90% with minimal response time',
];

export function TechnicalSpecs() {
  return (
    <div className="bg-white py-20">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center mb-20">
            <div>
              <h2 className="text-3xl lg:text-4xl mb-6">Technical Specifications</h2>
              <p className="text-lg text-gray-600 mb-8">
                Built on the ESP32 platform with integrated sensors and communication 
                modules for reliable fall detection and emergency response.
              </p>
              
              <div className="space-y-4">
                {components.map((component, index) => {
                  const Icon = component.icon;
                  return (
                    <div key={index} className="flex gap-4 p-4 bg-gray-50 rounded-lg">
                      <div className="flex-shrink-0">
                        <div className="p-2 bg-blue-100 rounded-lg">
                          <Icon className="size-5 text-blue-600" />
                        </div>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-1">{component.name}</h4>
                        <p className="text-sm text-gray-600">{component.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
            <div className="relative">
              <ImageWithFallback
                src="https://images.unsplash.com/photo-1761496847215-46592435aab0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxFU1AzMiUyMG1pY3JvY29udHJvbGxlciUyMGNpcmN1aXQlMjBib2FyZHxlbnwxfHx8fDE3NzQ0NTIwMzN8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
                alt="ESP32 Microcontroller"
                className="rounded-2xl shadow-xl w-full h-[500px] object-cover"
              />
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-2xl p-8 lg:p-12">
            <h3 className="text-2xl lg:text-3xl mb-8 text-center">Project Objectives</h3>
            <div className="grid md:grid-cols-2 gap-4 max-w-4xl mx-auto">
              {objectives.map((objective, index) => (
                <div key={index} className="flex gap-3 items-start">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-semibold mt-0.5">
                    {index + 1}
                  </div>
                  <p className="text-gray-700">{objective}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
