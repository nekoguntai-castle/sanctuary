/**
 * Icon Maps
 *
 * Maps background IDs to their corresponding Lucide icon components.
 */

import type { ComponentType } from 'react';
import { Image as ImageIcon, Waves, Minus, Server, Globe, Sparkles, Shield, Bitcoin, Circle, Binary, Network, Flower2, Snowflake, Box, Sun, Leaf, CloudSnow, Bug, Droplets, Flame, CloudRain, Fish, TreePine, Flower, Lamp, Cloud, Shell, Train, Mountain, Bird, Rabbit, Star, Sailboat, Wind, Haze, Bell, PartyPopper, Moon, TreeDeciduous, Heart, Share2, Palette, Zap, Send, Hash } from 'lucide-react';
import type { BackgroundPattern, BackgroundPatternIconKey } from '../../../../themes/types';
import { SanctuaryLogo, SatsIcon } from '../../../ui/CustomIcons';

export type BackgroundIcon = ComponentType<{ className?: string }>;

export const bgIconMap = {
  image: ImageIcon,
  waves: Waves,
  minus: Minus,
  server: Server,
  globe: Globe,
  sparkles: Sparkles,
  shield: Shield,
  bitcoin: Bitcoin,
  circle: Circle,
  binary: Binary,
  network: Network,
  flower2: Flower2,
  snowflake: Snowflake,
  box: Box,
  sun: Sun,
  leaf: Leaf,
  'cloud-snow': CloudSnow,
  bug: Bug,
  droplets: Droplets,
  flame: Flame,
  'cloud-rain': CloudRain,
  fish: Fish,
  'tree-pine': TreePine,
  flower: Flower,
  lamp: Lamp,
  cloud: Cloud,
  shell: Shell,
  train: Train,
  mountain: Mountain,
  bird: Bird,
  rabbit: Rabbit,
  star: Star,
  sailboat: Sailboat,
  wind: Wind,
  haze: Haze,
  bell: Bell,
  'party-popper': PartyPopper,
  moon: Moon,
  'tree-deciduous': TreeDeciduous,
  heart: Heart,
  share2: Share2,
  palette: Palette,
  zap: Zap,
  send: Send,
  hash: Hash,
  'sanctuary-logo': SanctuaryLogo,
  sats: SatsIcon,
} satisfies Record<BackgroundPatternIconKey, BackgroundIcon>;

export const getBackgroundPatternIcon = (pattern: Pick<BackgroundPattern, 'animated' | 'iconKey'>): BackgroundIcon => {
  if (pattern.iconKey) {
    return bgIconMap[pattern.iconKey];
  }

  return pattern.animated ? Sparkles : ImageIcon;
};

// Season icons for the time-based section
export const seasonIcons: Record<string, any> = {
  spring: Flower2,
  summer: Sun,
  fall: Leaf,
  winter: CloudSnow,
};
