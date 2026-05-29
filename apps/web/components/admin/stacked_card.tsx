import type { ReactNode } from 'react';

/** A flat outer frame wrapping a raised inner surface. Wrap any content. */
export function StackedCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`relative w-full max-w-[380px] rounded-[3rem] border border-neutral-200/60 bg-[#eeeeee] p-3 ${className ?? ''}`}
    >
      <div className="rounded-[2.25rem] border border-neutral-100 bg-white p-6 shadow-[0_2px_5px_rgba(0,0,0,0.06),0_16px_44px_-10px_rgba(0,0,0,0.24)]">
        {children}
      </div>
    </div>
  );
}
