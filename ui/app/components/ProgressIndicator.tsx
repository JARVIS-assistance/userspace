import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

interface ProgressIndicatorProps {
  label: string;
  targetValue: number;
}

export function ProgressIndicator({ label, targetValue }: ProgressIndicatorProps) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setValue(targetValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [targetValue]);

  return (
    <div className="relative">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-cyan-400/80 tracking-wide">{label}</span>
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-2xl font-bold text-cyan-400"
          style={{ textShadow: '0 0 10px #00f6ff' }}
        >
          {value}%
        </motion.span>
      </div>
      
      <div className="relative h-12 border border-cyan-500/30 bg-black/30 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 2, ease: "easeOut" }}
          className="h-full bg-gradient-to-r from-cyan-600 via-cyan-400 to-cyan-300 relative"
          style={{
            boxShadow: '0 0 20px rgba(0, 246, 255, 0.6)',
          }}
        >
          {/* Animated scan line */}
          <motion.div
            animate={{ x: ['0%', '100%'] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
            className="absolute inset-y-0 w-1 bg-white/50"
            style={{ boxShadow: '0 0 10px rgba(255, 255, 255, 0.8)' }}
          />
        </motion.div>

        {/* Grid pattern overlay */}
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: 'linear-gradient(0deg, transparent 24%, rgba(0, 246, 255, 0.2) 25%, rgba(0, 246, 255, 0.2) 26%, transparent 27%, transparent 74%, rgba(0, 246, 255, 0.2) 75%, rgba(0, 246, 255, 0.2) 76%, transparent 77%, transparent)',
          backgroundSize: '8px 8px',
        }} />
      </div>

      {/* Segments */}
      <div className="absolute top-8 left-0 right-0 h-12 flex">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex-1 border-r border-cyan-500/20 last:border-r-0" />
        ))}
      </div>
    </div>
  );
}
