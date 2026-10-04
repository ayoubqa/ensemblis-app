// Barrel for shared components: import { Avatar, Modal, useToast } from "@/components";
export { Icon, ICONS, type IconName } from "./Icon";
export { Logo, Mark, Lockup } from "./Logo";
export { Avatar, AvatarStack } from "./Avatar";
export { Tag, VerifiedTag, StatusTag, StepStatusTag, OutcomeTag, Rating, Stars, taskStatusLabel, type TagVariant } from "./Tags";
export { Modal } from "./Modal";
export { ToastProvider, useToast, type ToastFn, type ToastOptions } from "./Toast";
export { LineChart, Sparkline, PerfGraph, HBar, type PerfRow } from "./Charts";
export {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  PageSkeleton,
  ProgressBar,
  Meter,
  Tabs,
  ChipGroup,
  EmptyState,
  PageHead,
  Flow,
  FLOW_STEPS,
  KV,
  Stat,
  CountUp,
  Reveal,
  Kbd,
  type TabItem,
} from "./UI";
export { RequireAuth } from "./RequireAuth";
export { RoleSelectModal, RolePicker, type SignupRole } from "./RoleSelect";
export { ThemeSwitch } from "./ThemeSwitch";
export { ShellProvider, useShell, ShortcutsModal, SHORTCUTS } from "./Shell";
export { CommandPalette } from "./CommandPalette";
export { Header, BottomNav, useNotifications } from "./Header";
export { Footer } from "./Footer";
export { confetti } from "@/lib/confetti";
export { DemoBanner } from "./DemoBanner";
export { SampleTag } from "./SampleTag";
export { CharCount } from "./CharCount";
