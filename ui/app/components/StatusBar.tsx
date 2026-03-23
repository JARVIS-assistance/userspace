import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

export function StatusBar() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('ko-KR', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit' 
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8 }}
      className="absolute top-8 left-1/2 -translate-x-1/2 flex items-center gap-8 px-8 py-3 border border-cyan-500/30 bg-black/40 backdrop-blur-sm"
      style={{ boxShadow: '0 0 20px rgba(0, 246, 255, 0.2)' }}
    >
      {/* Time */}
      <div className="flex items-center gap-3">
        <span className="text-4xl font-mono tracking-wider text-cyan-400" style={{ textShadow: '0 0 15px #00f6ff' }}>
          {formatTime(time)}
        </span>
        <div className="text-xs text-cyan-400/60">
          <div>{formatDate(time)}</div>
          <div>{time.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</div>
        </div>
      </div>

      {/* Separator */}
      <div className="w-px h-8 bg-cyan-500/30" />

      {/* Status */}
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" style={{ boxShadow: '0 0 10px #00f6ff' }} />
        <span className="text-sm tracking-wider text-cyan-400">SYSTEMS ONLINE</span>
      </div>
    </motion.div>
  );
}
