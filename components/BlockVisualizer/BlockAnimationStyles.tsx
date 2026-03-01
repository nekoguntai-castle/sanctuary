import React from 'react';

// CSS animation styles for block transitions
export const BlockAnimationStyles: React.FC = () => (
  <style>{`
    @keyframes blockEnter {
      0% {
        transform: translateX(-100%) scale(0.8);
        opacity: 0;
      }
      100% {
        transform: translateX(0) scale(1);
        opacity: 1;
      }
    }

    @keyframes blockExit {
      0% {
        transform: translateX(0);
        opacity: 1;
      }
      100% {
        transform: translateX(100%);
        opacity: 0;
      }
    }

    @keyframes blockSlide {
      0% {
        transform: translateX(0);
      }
      100% {
        transform: translateX(calc(100% + 12px));
      }
    }

    @keyframes pulse-glow {
      0%, 100% {
        box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.4);
      }
      50% {
        box-shadow: 0 0 20px 10px rgba(251, 191, 36, 0.2);
      }
    }

    .animate-block-enter {
      animation: blockEnter 0.5s ease-out forwards;
    }

    .animate-block-exit {
      animation: blockExit 0.5s ease-in forwards;
    }

    .animate-block-slide {
      animation: blockSlide 0.5s ease-in-out forwards;
    }

    .animate-pulse-glow {
      animation: pulse-glow 2s ease-in-out infinite;
    }

    .scrollbar-hide::-webkit-scrollbar {
      display: none;
    }
    .scrollbar-hide {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
  `}</style>
);
