// Barrel for shared components: import { Avatar, Modal, useToast } from "@/components";
export { Icon, ICONS, type IconName } from "./Icon";
export { Logo, Mark, Lockup } from "./Logo";
export { Avatar, AvatarStack } from "./Avatar";
export { Tag, StatusTag, StepStatusTag, OutcomeTag, VerificationTag, CriterionTag, ClaimTag, RiskTag, statusLabel, outcomeLabel, isLiveStatus, type TagVariant } from "./Tags";
export { Modal } from "./Modal";
export { ToastProvider, useToast, type ToastFn, type ToastOptions } from "./Toast";
export { LineChart, Sparkline, HBar } from "./Charts";
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
export { ThemeSwitch } from "./ThemeSwitch";
export { ShellProvider, useShell, ShortcutsModal, SHORTCUTS } from "./Shell";
export { CommandPalette } from "./CommandPalette";
export { Header, BottomNav, useAttention, refreshAttention } from "./Header";
export { Footer } from "./Footer";
export { DemoBanner } from "./DemoBanner";
export { CharCount } from "./CharCount";
