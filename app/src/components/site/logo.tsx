import Link from "next/link";
import { cn } from "@/lib/utils";

/** Default brand mark: a magnifier over rising bars (rankings going up), with an amber handle. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path d="m19.6 19.6 5 5" stroke="#fbbf24" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="14" cy="14" r="7.2" fill="none" stroke="white" strokeWidth="2.6" />
      <rect x="10.3" y="15.2" width="2.2" height="2.4" rx="0.7" fill="white" />
      <rect x="12.9" y="13" width="2.2" height="4.6" rx="0.7" fill="white" />
      <rect x="15.5" y="10.4" width="2.2" height="7.2" rx="0.7" fill="white" />
    </svg>
  );
}

export function Logo({
  siteName,
  logo,
  logoDark,
  href = "/",
  className,
}: {
  siteName: string;
  logo?: string;
  logoDark?: string;
  href?: string;
  className?: string;
}) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5", className)} aria-label={`${siteName} home`}>
      {logo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- admin-uploaded logo of unknown size */}
          <img src={logo} alt={siteName} className={cn("h-8 w-auto max-w-full object-contain object-left rtl:object-right", logoDark && "dark:hidden")} />
          {logoDark ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoDark} alt={siteName} className="hidden h-8 w-auto max-w-full object-contain object-left dark:block rtl:object-right" />
          ) : null}
        </>
      ) : (
        <>
          <BrandMark className="shrink-0" />
          <span className="truncate font-display text-xl font-bold tracking-tight text-ink">{siteName}</span>
        </>
      )}
    </Link>
  );
}
