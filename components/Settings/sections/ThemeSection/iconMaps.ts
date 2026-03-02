/**
 * Icon Maps
 *
 * Maps background IDs to their corresponding Lucide icon components.
 */

import { Image as ImageIcon, Waves, Minus, Server, Globe, Sparkles, Shield, Bitcoin, Circle, Binary, Network, Flower2, Snowflake, Box, Sun, Leaf, CloudSnow, Bug, Droplets, Flame, CloudRain, Fish, TreePine, Flower, Lamp, Cloud, Shell, Train, Mountain, Bird, Rabbit, Star, Sailboat, Wind, Haze, Bell, PartyPopper, Moon, TreeDeciduous, Heart, Share2, Palette, Zap, Send, Hash } from 'lucide-react';
import { SanctuaryLogo, SatsIcon } from '../../../ui/CustomIcons';

export const bgIconMap: Record<string, any> = {
  // Static patterns
  minimal: Minus,
  zen: ImageIcon,
  sanctuary: SanctuaryLogo,
  'sanctuary-hero': SanctuaryLogo,
  waves: Waves,
  lines: Minus,
  circuit: Server,
  topography: Globe,
  hexagons: Network,
  stars: Star,
  // Bitcoin-themed animations
  'sakura-petals': Flower2,
  'floating-shields': Shield,
  'bitcoin-particles': Bitcoin,
  'stacking-blocks': Box,
  'digital-rain': Binary,
  'constellation': Network,
  'sanctuary-logo': SanctuaryLogo,
  'sats-symbol': SatsIcon,
  // Weather & nature animations
  'snowfall': Snowflake,
  'fireflies': Bug,
  'ink-drops': Droplets,
  'rippling-water': Waves,
  'falling-leaves': Leaf,
  'embers-rising': Flame,
  'gentle-rain': CloudRain,
  'northern-lights': Sparkles,
  // Sumi-e (ink wash) animations
  'koi-shadows': Fish,
  'bamboo-sway': TreePine,
  // Zen & nature animations
  'lotus-bloom': Flower,
  'floating-lanterns': Lamp,
  'moonlit-clouds': Cloud,
  'tide-pools': Shell,
  // Fun animations
  'train-station': Train,
  'fireworks': PartyPopper,
  // Landscape animations
  'serene-meadows': TreeDeciduous,
  'still-ponds': Droplets,
  'desert-dunes': Sun,
  'mountain-mist': Mountain,
  'misty-valley': Haze,
  // Cute animals
  'duckling-parade': Bird,
  'bunny-meadow': Rabbit,
  // Night sky
  'stargazing': Star,
  // Serene animations
  'lavender-fields': Flower,
  'zen-sand-garden': Circle,
  'sunset-sailing': Sailboat,
  'raindrop-window': CloudRain,
  // Nature animations
  'butterfly-garden': Bug,
  'dandelion-wishes': Wind,
  'gentle-waves': Waves,
  // Additional serene animations
  'jellyfish-drift': Shell,
  'wind-chimes': Bell,
  'sakura-redux': Flower2,
  // New animations
  'hash-storm': Hash,
  'ice-crystals': Snowflake,
  'autumn-wind': Wind,
  // Abstract animations
  'smoke-calligraphy': Wind,
  'breath': Heart,
  'mycelium-network': Share2,
  'oil-slick': Palette,
  // New landscape/nature animations
  'bioluminescent-beach': Waves,
  'volcanic-islands': Mountain,
  'tidal-patterns': Shell,
  'eclipse': Moon,
  'paper-boats': Sailboat,
  'paper-airplanes': Send,
  'thunderstorm': Zap,
};

// Season icons for the time-based section
export const seasonIcons: Record<string, any> = {
  spring: Flower2,
  summer: Sun,
  fall: Leaf,
  winter: CloudSnow,
};
