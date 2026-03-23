import { motion } from 'motion/react';
import { Activity, Cpu, HardDrive, Zap } from 'lucide-react';

interface SystemMetric {
  label: string;
  value: number;
  unit: string;
  icon: React.ReactNode;
}

export function SystemDiagnostics() {
  const metrics: SystemMetric[] = [
    { label: 'CPU USAGE', value: 67, unit: '%', icon: <Cpu className="w-4 h-4" /> },
    { label: 'MEMORY', value: 8.4, unit: 'GB', icon: <HardDrive className="w-4 h-4" /> },
    { label: 'POWER', value: 89, unit: '%', icon: <Zap className="w-4 h-4" /> },
    { label: 'NETWORK', value: 234, unit: 'Mbps', icon: <Activity className="w-4 h-4" /> },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, x: -50 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.8 }}
      className="relative p-6 border border-cyan-500/30 bg-black/40 backdrop-blur-sm"
      style={{
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%)',
        boxShadow: '0 0 20px rgba(0, 246, 255, 0.2)',
      }}
    >
      <div className="mb-4 pb-3 border-b border-cyan-500/30">
        <h3 className="text-lg tracking-wider text-cyan-400" style={{ textShadow: '0 0 10px #00f6ff' }}>
          SYSTEM DIAGNOSTICS
        </h3>
      </div>

      <div className="space-y-4">
        {metrics.map((metric, index) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 + 0.3, duration: 0.5 }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-cyan-400">{metric.icon}</span>
                <span className="text-xs text-cyan-400/80 tracking-wide">{metric.label}</span>
              </div>
              <span className="text-sm text-cyan-300">
                {metric.value} {metric.unit}
              </span>
            </div>
            <div className="relative h-2 bg-cyan-950/50 rounded overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${typeof metric.value === 'number' && metric.unit === '%' ? metric.value : (metric.value / 100) * 100}%` }}
                transition={{ delay: index * 0.1 + 0.5, duration: 1, ease: "easeOut" }}
                className="h-full bg-gradient-to-r from-cyan-500 to-cyan-300"
                style={{
                  boxShadow: '0 0 10px rgba(0, 246, 255, 0.5)',
                }}
              />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Decorative corner */}
      <div className="absolute bottom-0 right-0 w-5 h-5 border-r border-b border-cyan-500/50" />
    </motion.div>
  );
}
