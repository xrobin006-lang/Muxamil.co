import {
  BookOpen,
  Briefcase,
  Camera,
  Code,
  Dumbbell,
  FlaskConical,
  Gamepad2,
  Globe,
  GraduationCap,
  Heart,
  HeartPulse,
  Laptop,
  Lightbulb,
  Megaphone,
  MessageCircle,
  Music,
  Newspaper,
  Palette,
  Plane,
  Rocket,
  Shapes,
  ShoppingCart,
  Smartphone,
  Star,
  Trophy,
  Utensils,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react'

/**
 * Safe allow-list of lucide icons renderable from the admin's category pick.
 * Single source shared by the Explore grid tiles and the category page
 * header, so both always show the same icon for a category.
 */
const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  'book-open': BookOpen,
  book: BookOpen,
  briefcase: Briefcase,
  camera: Camera,
  code: Code,
  dumbbell: Dumbbell,
  'gamepad-2': Gamepad2,
  globe: Globe,
  'graduation-cap': GraduationCap,
  heart: Heart,
  'heart-pulse': HeartPulse,
  laptop: Laptop,
  lightbulb: Lightbulb,
  megaphone: Megaphone,
  'message-circle': MessageCircle,
  music: Music,
  newspaper: Newspaper,
  palette: Palette,
  plane: Plane,
  rocket: Rocket,
  science: FlaskConical,
  shapes: Shapes,
  'shopping-cart': ShoppingCart,
  smartphone: Smartphone,
  star: Star,
  trophy: Trophy,
  utensils: Utensils,
  users: Users,
  video: Video,
}

/** Resolve a category's stored icon name to a safe lucide component. */
export function iconFor(name: string | null | undefined): LucideIcon {
  if (!name) return Shapes
  return CATEGORY_ICON_MAP[name.trim().toLowerCase()] ?? Shapes
}
