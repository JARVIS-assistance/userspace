import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Navigation } from 'lucide-react';

export function FlightCompass() {
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setRotation((prev) => (prev + 1) % 360);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative flex items-center justify-center">
      {/* Outer ring */}
      <svg width="400" height="400" className="absolute">
        <defs>
          <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00f6ff" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#0077ff" stopOpacity="0.4" />
          </linearGradient>
        </defs>
        <circle
          cx="200"
          cy="200"
          r="180"
          fill="none"
          stroke="url(#ringGradient)"
          strokeWidth="2"
          opacity="0.3"
        />
        <circle
          cx="200"
          cy="200"
          r="160"
          fill="none"
          stroke="#00f6ff"
          strokeWidth="1"
          opacity="0.2"
        />
      </svg>

      {/* Rotating compass ring */}
      <motion.div
        animate={{ rotate: rotation }}
        transition={{ duration: 0.1, ease: "linear" }}
        className="absolute w-80 h-80"
      >
        <svg width="320" height="320" viewBox="0 0 320 320">
          {/* Tick marks */}
          {Array.from({ length: 72 }).map((_, i) => {
            const angle = (i * 5 * Math.PI) / 180;
            const isMainTick = i % 6 === 0;
            const innerRadius = isMainTick ? 140 : 150;
            const outerRadius = 160;
            const x1 = 160 + innerRadius * Math.cos(angle - Math.PI / 2);
            const y1 = 160 + innerRadius * Math.sin(angle - Math.PI / 2);
            const x2 = 160 + outerRadius * Math.cos(angle - Math.PI / 2);
            const y2 = 160 + outerRadius * Math.sin(angle - Math.PI / 2);

            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isMainTick ? "#00f6ff" : "#00f6ff"}
                strokeWidth={isMainTick ? 2 : 1}
                opacity={isMainTick ? 0.8 : 0.4}
              />
            );
          })}
        </svg>
      </motion.div>

      {/* Center circle with FLIGHT label */}
      <div className="relative z-10 flex items-center justify-center">
        <div className="relative w-48 h-48 rounded-full bg-gradient-to-br from-black via-gray-900 to-black border-2 border-cyan-500/50 flex items-center justify-center"
          style={{ boxShadow: '0 0 30px rgba(0, 246, 255, 0.3), inset 0 0 30px rgba(0, 0, 0, 0.8)' }}
        >
          {/* Inner rings */}
          <div className="absolute w-40 h-40 rounded-full border border-cyan-500/20" />
          <div className="absolute w-32 h-32 rounded-full border border-cyan-500/30" />
          
          {/* Crosshair */}
          <div className="absolute w-full h-0.5 bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
          <div className="absolute w-0.5 h-full bg-gradient-to-b from-transparent via-cyan-400/50 to-transparent" />
          
          {/* Center content */}
          <div className="relative z-10 flex flex-col items-center">
            <Navigation className="w-8 h-8 text-cyan-400 mb-2" style={{ filter: 'drop-shadow(0 0 5px #00f6ff)' }} />
            <span className="text-sm tracking-[0.3em] text-cyan-400" style={{ textShadow: '0 0 10px #00f6ff' }}>
              FLIGHT
            </span>
          </div>
        </div>
      </div>

      {/* Cardinal directions */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative w-96 h-96">
          {[
            { dir: 'N', angle: 0, icon: '↑' },
            { dir: 'E', angle: 90, icon: '→' },
            { dir: 'S', angle: 180, icon: '↓' },
            { dir: 'W', angle: 270, icon: '←' },
          ].map(({ dir, angle, icon }) => (
            <div
              key={dir}
              className="absolute text-cyan-400 text-lg font-bold"
              style={{
                top: '50%',
                left: '50%',
                transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-185px)`,
                textShadow: '0 0 10px #00f6ff',
              }}
            >
              <span style={{ display: 'inline-block', transform: `rotate(-${angle}deg)` }}>
                {icon}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
