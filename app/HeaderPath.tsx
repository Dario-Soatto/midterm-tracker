import Link from "next/link";

export default function HeaderPath() {
  return (
    <div className="text-[10px] tracking-widest uppercase text-[var(--color-ink-soft)]">
      <Link href="/" className="hover:text-[var(--color-ink)]">
        m26
      </Link>
      <span className="text-[var(--color-ink-mute)]"> / </span>
      <span className="text-[var(--color-ink-mute)]">midterms 2026</span>
    </div>
  );
}
