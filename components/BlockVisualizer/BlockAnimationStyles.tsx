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

    .block-visualizer-frame {
      position: relative;
    }

    .block-visualizer-button {
      position: relative;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      overflow: hidden;
      cursor: pointer;
    }

    .block-visualizer-tooltip {
      position: absolute;
      bottom: 100%;
      left: 50%;
      margin-bottom: 0.5rem;
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, -0.25rem);
      transition: opacity 0.2s ease, transform 0.2s ease;
      white-space: nowrap;
      z-index: 50;
    }

    .block-visualizer-frame:hover .block-visualizer-tooltip,
    .block-visualizer-frame:focus-within .block-visualizer-tooltip {
      opacity: 1;
      transform: translate(-50%, 0);
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
