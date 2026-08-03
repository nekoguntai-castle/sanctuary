/**
 * LoginBackground - Shared atmospheric background for login screens
 *
 * Includes vignette, ambient glow, floating dust motes, and canvas animation.
 */

import React, { lazy, Suspense } from 'react';

const AnimatedBackground = lazy(() => import('../AnimatedBackground'));

// Floating dust motes configuration
const DUST_MOTES = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  size: 2 + Math.random() * 3,
  left: Math.random() * 100,
  top: Math.random() * 100,
  dx: (Math.random() - 0.5) * 200,
  dy: -50 - Math.random() * 150,
  duration: 20 + Math.random() * 20,
  delay: Math.random() * 15,
}));

interface LoginBackgroundProps {
  darkMode: boolean;
  children: React.ReactNode;
}

export const LoginBackground: React.FC<LoginBackgroundProps> = ({ darkMode, children }) => (
  <div className="min-h-screen flex items-center justify-center bg-atmospheric p-4 transition-colors duration-500 relative overflow-hidden">
    {/* Canvas background animation */}
    <Suspense fallback={null}>
      <AnimatedBackground
        pattern={darkMode ? 'fireflies' : 'zen-sand-garden'}
        darkMode={darkMode}
        opacity={darkMode ? 18 : 12}
      />
    </Suspense>
    {/* Vignette overlay */}
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_30%,_rgba(250,250,250,0.15)_100%)] dark:bg-[radial-gradient(ellipse_at_center,_transparent_30%,_rgba(0,0,0,0.4)_100%)] pointer-events-none z-[1]" />
    {/* Ambient glow behind card */}
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-success-50/30 dark:bg-success-700/[0.07] blur-[120px] pointer-events-none z-[1]" />
    {/* Floating dust motes */}
    {DUST_MOTES.map((mote) => (
      <div
        key={mote.id}
        className="dust-mote bg-warning-500/40 dark:bg-warning-600/30"
        style={{
          width: mote.size,
          height: mote.size,
          left: `${mote.left}%`,
          top: `${mote.top}%`,
          '--dust-dx': `${mote.dx}px`,
          '--dust-dy': `${mote.dy}px`,
          '--dust-duration': `${mote.duration}s`,
          '--dust-delay': `${mote.delay}s`,
        } as React.CSSProperties}
      />
    ))}
    <div className="relative z-10 max-w-md w-full space-y-8">
      {children}
    </div>
  </div>
);
