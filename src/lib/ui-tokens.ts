/**
 * Shared className fragments for interactive elements outside the `Button`
 * component (Toggle, SegmentedTabs, icon buttons, …) so focus/press states
 * don't drift into slightly different rings/durations per component.
 */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

export const PRESS_FEEDBACK = "active:scale-[0.97] transition-transform duration-100";
