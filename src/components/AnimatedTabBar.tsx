/**
 * AnimatedTabBar — a fancy tab strip with a sliding pill indicator.
 *
 * The indicator is a single absolutely-positioned <span> whose
 * `transform` and `width` are mutated **directly on the DOM node** in a
 * layout effect (rather than driven through React state). Driving it via
 * state caused the bubble to "pop" between tabs because the
 * useLayoutEffect → setState → re-render cycle collapsed into a single
 * browser paint, denying the CSS transition its from→to keyframes. With
 * direct mutation the previous DOM transform is the indicator's true
 * previous position, so the browser sees a clean diff and animates the
 * slide.
 *
 * Each tab declares a `variant` (e.g. `catalog`, `plan`, `quote`). The
 * indicator carries the active variant via `data-variant` so theming
 * (background gradient, glow color, text tint) is purely CSS — no
 * React work needed for the color crossfade.
 *
 * Tabs may be route-driven (`to`/`end` → renders a NavLink and uses the
 * current location to choose the active tab) or state-driven (`onClick`
 * + `activeId` prop on the bar). Mixing the two within one bar is
 * intentionally not supported — the bar picks the mode based on whether
 * any tab declares a `to`.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { NavLink, useLocation } from "react-router-dom";

export type AnimatedTabBarTab = {
  /** Stable identity used for state-driven bars and React keys. */
  id: string;
  label: ReactNode;
  /**
   * Color/theming variant suffix. Drives both the per-tab text tint
   * (`.animated-tabs__tab--{variant}`) and the indicator color
   * (selected via `[data-variant="..."]` on the indicator node).
   */
  variant: string;
  /** When set, the tab renders as a NavLink and the bar runs in route mode. */
  to?: string;
  end?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
};

type Props = {
  tabs: AnimatedTabBarTab[];
  /** Required for state-driven (non-route) bars. Ignored when tabs use `to`. */
  activeId?: string;
  ariaLabel?: string;
  /** Extra class on the container for layout-specific tweaks. */
  className?: string;
};

export function AnimatedTabBar({ tabs, activeId, ariaLabel, className }: Props) {
  const location = useLocation();
  const containerRef = useRef<HTMLElement | null>(null);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const tabRefs = useRef<Array<HTMLElement | null>>([]);
  /**
   * On the very first measurement we want the bubble to appear instantly
   * at the active tab — without this guard the CSS transition would
   * animate it growing out of `width:0` at the container's left edge,
   * which looks like a glitch on page load. We disable the transition
   * for one frame, position the indicator, then restore it so all
   * subsequent moves slide smoothly.
   */
  const isFirstPositionRef = useRef(true);

  const isRouteMode = useMemo(() => tabs.some((t) => t.to != null), [tabs]);

  const activeIndex = useMemo(() => {
    if (isRouteMode) {
      const path = location.pathname;
      const idx = tabs.findIndex((tab) => {
        if (tab.to == null) return false;
        if (tab.end) return path === tab.to;
        return path === tab.to || path.startsWith(`${tab.to}/`);
      });
      if (idx >= 0) return idx;
      // Fall back to the root tab so the bubble never disappears.
      const rootIdx = tabs.findIndex((t) => t.end && t.to === "/");
      return rootIdx >= 0 ? rootIdx : 0;
    }
    if (activeId != null) {
      const idx = tabs.findIndex((t) => t.id === activeId);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  }, [tabs, isRouteMode, location.pathname, activeId]);

  /**
   * Measure the active tab and write the indicator's position + variant
   * directly to the DOM. We deliberately avoid React state here so the
   * indicator's previous DOM `transform` value (set by the previous
   * activation) is what the browser interpolates from — that's what
   * gives the slide its smoothness.
   */
  const positionIndicator = useCallback(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    const tab = tabRefs.current[activeIndex];
    if (!container || !indicator || !tab) return;
    const cRect = container.getBoundingClientRect();
    const tRect = tab.getBoundingClientRect();
    const variant = tabs[activeIndex]?.variant ?? "";
    const apply = () => {
      indicator.style.transform = `translateX(${tRect.left - cRect.left}px)`;
      indicator.style.width = `${tRect.width}px`;
      indicator.style.opacity = "1";
      indicator.dataset.variant = variant;
    };
    if (isFirstPositionRef.current) {
      // Snap into place on first mount, then re-enable the slide.
      indicator.style.transition = "none";
      apply();
      // Force a reflow so the "no transition" rule is committed before
      // we restore the transition CSS — without this the browser might
      // batch both writes into a single paint and still animate.
      void indicator.offsetWidth;
      indicator.style.transition = "";
      isFirstPositionRef.current = false;
    } else {
      apply();
    }
  }, [activeIndex, tabs]);

  useLayoutEffect(() => {
    positionIndicator();
  }, [positionIndicator]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => positionIndicator());
    ro.observe(container);
    tabRefs.current.forEach((el) => {
      if (el) ro.observe(el);
    });
    const onWinResize = () => positionIndicator();
    window.addEventListener("resize", onWinResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWinResize);
    };
  }, [positionIndicator]);

  const containerClass = `animated-tabs${className ? ` ${className}` : ""}`;

  const renderTab = (tab: AnimatedTabBarTab, i: number) => {
    const isActive = i === activeIndex;
    const cn = `animated-tabs__tab animated-tabs__tab--${tab.variant}${
      isActive ? " animated-tabs__tab--active" : ""
    }`;
    const setRef = (el: HTMLElement | null) => {
      tabRefs.current[i] = el;
    };
    if (isRouteMode && tab.to != null) {
      return (
        <NavLink
          key={tab.id}
          to={tab.to}
          end={tab.end}
          className={cn}
          title={tab.title}
          ref={setRef}
        >
          <span className="animated-tabs__tab-label">{tab.label}</span>
        </NavLink>
      );
    }
    return (
      <button
        key={tab.id}
        type="button"
        role={isRouteMode ? undefined : "tab"}
        aria-selected={isRouteMode ? undefined : isActive}
        className={cn}
        disabled={tab.disabled}
        title={tab.title}
        onClick={tab.onClick}
        ref={setRef}
      >
        <span className="animated-tabs__tab-label">{tab.label}</span>
      </button>
    );
  };

  const indicatorVariant = tabs[activeIndex]?.variant ?? "";

  if (isRouteMode) {
    return (
      <nav
        ref={(el) => {
          containerRef.current = el;
        }}
        className={containerClass}
        aria-label={ariaLabel}
      >
        <span
          ref={indicatorRef}
          className="animated-tabs__indicator"
          data-variant={indicatorVariant}
          aria-hidden="true"
        />
        {tabs.map(renderTab)}
      </nav>
    );
  }

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
      }}
      className={containerClass}
      role="tablist"
      aria-label={ariaLabel}
    >
      <span
        ref={indicatorRef}
        className="animated-tabs__indicator"
        data-variant={indicatorVariant}
        aria-hidden="true"
      />
      {tabs.map(renderTab)}
    </div>
  );
}
