import Link from 'next/link';
import type { ReactNode, SVGProps } from 'react';
import { IconArrowUpRight } from './icons';

type IconType = (p: SVGProps<SVGSVGElement>) => ReactNode;

interface BaseCardProps {
  icon: IconType;
  label: string;
  href?: string;
  badge?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * The shared shell every admin card uses. Establishes the base card grammar:
 * white rounded card, dark icon disc top-left, optional badge + arrow top-right,
 * label below the icon, free-form content below the label.
 */
export function Card({ icon: Icon, label, href, badge, className = '', children }: BaseCardProps) {
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-900 text-white">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex items-center gap-2">
          {badge && (
            <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-[11px] text-stone-600">
              {badge}
            </span>
          )}
          {href && (
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 transition group-hover:border-stone-400 group-hover:text-stone-900">
              <IconArrowUpRight className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </div>
      <div className="mt-4 text-[15px] leading-tight text-stone-700">{label}</div>
      {children}
    </>
  );

  const classes = `group relative flex flex-col rounded-2xl border border-stone-200/70 bg-white p-6 transition hover:border-stone-300 ${className}`;

  if (href) {
    const isExternal = /^https?:\/\//.test(href);
    if (isExternal) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`${classes} no-underline`}
        >
          {inner}
        </a>
      );
    }
    return (
      <Link href={href} className={`${classes} no-underline`}>
        {inner}
      </Link>
    );
  }
  return <div className={classes}>{inner}</div>;
}

/**
 * The headline metric pattern: big number bottom-left, optional secondary
 * caption next to it. Use inside <Card> as the body.
 */
export function Metric({ value, caption }: { value: ReactNode; caption?: ReactNode }) {
  return (
    <div className="mt-auto pt-8">
      <div className="text-[44px] font-light leading-none tracking-tight text-stone-900">
        {value}
      </div>
      {caption && <div className="mt-2 text-xs text-stone-500">{caption}</div>}
    </div>
  );
}
