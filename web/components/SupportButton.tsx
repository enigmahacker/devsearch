import { Heart } from "lucide-react";

const RAZORPAY_HOSTS = ["razorpay.me", "rzp.io", "pages.razorpay.com", "razorpay.com"];

/** Links to a Razorpay-hosted payment page or link; this app never touches payment details. Hidden unless SUPPORT_URL is a Razorpay https URL. */
export function SupportButton() {
  let url: URL;
  try {
    url = new URL(process.env.SUPPORT_URL ?? "");
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !RAZORPAY_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return null;
  return (
    <a
      href={url.href}
      target="_blank"
      rel="noopener noreferrer"
      className="support-btn inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium transition-all hover:border-primary/60 hover:bg-primary/20 active:scale-95"
    >
      <Heart className="size-3.5 text-[var(--primary)]" aria-hidden />
      Support the developer
    </a>
  );
}
