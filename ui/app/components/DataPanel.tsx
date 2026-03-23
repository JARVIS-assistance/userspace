import { motion } from 'motion/react';
import { Database, Wifi, Battery } from 'lucide-react';

interface DataItem {
  label: string;
  value: string;
  status: 'online' | 'warning' | 'critical';
}

export function DataPanel() {
  const dataItems: DataItem[] = [
    { label: 'GPS STORAGE', value: '512 TB', status: 'online' },
    { label: 'CONNECTION', value: '5G ULTRA', status: 'online' },
    { label: 'BATTERY', value: '87%', status: 'online' },
    { label: 'SYNC STATUS', value: 'ACTIVE', status: 'online' },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return '#00f6ff';
      case 'warning': return '#ffaa00';
      case 'critical': return '#ff0055';
      default: return '#00f6ff';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.8, delay: 0.2 }}
      className="relative p-6 border border-cyan-500/30 bg-black/40 backdrop-blur-sm"
      style={{
        clipPath: 'polygon(20px 0, 100% 0, 100% 100%, 0 100%, 0 20px)',
        boxShadow: '0 0 20px rgba(0, 246, 255, 0.2)',
      }}
    >
      <div className="mb-4 pb-3 border-b border-cyan-500/30 flex items-center gap-2">
        <Database className="w-5 h-5 text-cyan-400" />
        <h3 className="text-lg tracking-wider text-cyan-400" style={{ textShadow: '0 0 10px #00f6ff' }}>
          DATA STORAGE
        </h3>
      </div>

      <div className="space-y-4">
        {dataItems.map((item, index) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 + 0.4, duration: 0.5 }}
            className="flex items-center justify-between p-3 border border-cyan-500/20 bg-black/30"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{
                  backgroundColor: getStatusColor(item.status),
                  boxShadow: `0 0 10px ${getStatusColor(item.status)}`,
                }}
              />
              <span className="text-sm text-cyan-400/80 tracking-wide">{item.label}</span>
            </div>
            <span className="text-sm text-cyan-300 font-mono">{item.value}</span>
          </motion.div>
        ))}
      </div>

      {/* Icons decoration */}
      <div className="absolute top-4 right-4 flex gap-2">
        <Wifi className="w-4 h-4 text-cyan-400/50" />
        <Battery className="w-4 h-4 text-cyan-400/50" />
      </div>

      {/* Decorative corner */}
      <div className="absolute top-0 left-0 w-5 h-5 border-l border-t border-cyan-500/50" />
    </motion.div>
  );
}
