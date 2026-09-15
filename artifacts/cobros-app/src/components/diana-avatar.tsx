/** Diana's shared, decorative portrait; surrounding controls provide her name. */
export function DianaAvatar({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 rounded-full ${className}`} aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="32" fill="#090F16" />
      <path d="M14 60c1-13 8-18 18-18s17 5 18 18" fill="#F2A900" />
      <path d="M21 45l11 14 11-14-7-4h-8z" fill="#FFF0CC" />
      <path d="M27 36h10v10l-5 5-5-5z" fill="#DDAE63" />
      <path d="M17 40V25c0-12 6-18 15-18s16 7 16 18v17l-10-3H25z" fill="#171E26" stroke="#F2A900" strokeWidth="1.5" />
      <path d="M22 25c0-6 4-12 10-12s11 6 11 12v5c0 9-5 14-11 14s-10-6-10-14z" fill="#F4CF93" />
      <path d="M20 26c8-1 13-6 15-11 1 7 4 10 10 12l-2-11-11-6-10 6z" fill="#171E26" />
      <path d="M25 27h3m8 0h3" stroke="#171E26" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="27" cy="30" r="1.1" fill="#171E26" />
      <circle cx="37" cy="30" r="1.1" fill="#171E26" />
      <path d="M32 30l-1 4h2m-5 3q4 4 8 0" fill="none" stroke="#805632" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="21" cy="34" r="1.5" fill="#F2A900" />
      <circle cx="43" cy="34" r="1.5" fill="#F2A900" />
      <path d="M22 46l-3 14m23-14 3 14" stroke="#090F16" strokeWidth="2" />
    </svg>
  );
}