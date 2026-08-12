import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

type Variant = "up" | "left" | "right" | "zoom";

const variantClass: Record<Variant, string> = {
  up: "reveal-up",
  left: "reveal-left",
  right: "reveal-right",
  zoom: "reveal-zoom",
};

/**
 * Scroll-reveal wrapper: hidden until it enters the viewport, then animates in
 * (fade + slide/zoom) via CSS transitions. `delayMs` staggers cascades.
 * Respects prefers-reduced-motion (handled in CSS: content shows immediately).
 */
export function Reveal({
  children,
  variant = "up",
  delayMs = 0,
  className = "",
}: {
  children: ReactNode;
  variant?: Variant;
  delayMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${variantClass[variant]} ${visible ? "reveal-visible" : ""} ${className}`}
      style={{ "--reveal-delay": `${delayMs}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/**
 * Animated counter that counts from 0 up to a numeric target embedded in
 * `value` (e.g. "14 días", "$0", "5 min") when it enters the viewport.
 * Respects prefers-reduced-motion (shows the final value immediately).
 */
export function CountUp({ value }: { value: string }) {
  const match = value.match(/\d+/);
  const target = match ? parseInt(match[0], 10) : 0;
  const ref = useRef<HTMLSpanElement>(null);
  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion || target === 0 || typeof IntersectionObserver === "undefined") {
      setCurrent(target);
      setDone(true);
      return;
    }
    let rafId = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const duration = 1200;
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - t, 3);
          setCurrent(Math.round(eased * target));
          if (t < 1) rafId = requestAnimationFrame(tick);
          else setDone(true);
        };
        rafId = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [target]);

  const display =
    done || !match ? value : value.replace(match[0], String(current));
  return <span ref={ref}>{display}</span>;
}
