/** Single-weight line icons (decorative: always aria-hidden; pair with visible text). */
import type { ReactNode } from "react";
import { cn } from "./cn";

// ---- Icons (single-weight line icons; no cartoon glyphs) -----------------------------------------------------------------

type IconProps = { className?: string };
const icon = (path: ReactNode) =>
  function Icon({ className }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={cn("h-4 w-4", className)}
      >
        {path}
      </svg>
    );
  };

export const CheckIcon = icon(<path d="M20 6 9 17l-5-5" />);
export const CheckCircleIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  </>,
);
export const AlertIcon = icon(
  <>
    <path d="M12 3 2.5 20h19z" />
    <path d="M12 10v4M12 17.5v.01" />
  </>,
);
export const InfoIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5v.01" />
  </>,
);
export const CopyIcon = icon(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </>,
);
export const XIcon = icon(<path d="M18 6 6 18M6 6l12 12" />);
export const ArrowRightIcon = icon(<path d="M5 12h14M13 6l6 6-6 6" />);
export const ExternalIcon = icon(
  <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
);
export const ShieldIcon = icon(
  <path d="M12 3 4.5 6v6c0 4.5 3.2 7.6 7.5 9 4.3-1.4 7.5-4.5 7.5-9V6z" />,
);
export const LockIcon = icon(
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>,
);
export const FileIcon = icon(
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </>,
);
export const LinkIcon = icon(
  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
);
export const KeyIcon = icon(
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M17 6l3 3M14 9l2 2" />
  </>,
);
export const UsersIcon = icon(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" />
  </>,
);
export const GlobeIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </>,
);
export const HomeIcon = icon(
  <path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
);
export const ListIcon = icon(<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />);
export const ActivityIcon = icon(<path d="M3 12h4l3-8 4 16 3-8h4" />);
export const PlugIcon = icon(<path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0zM12 17v4" />);
export const BuildingIcon = icon(
  <>
    <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18" />
    <path d="M8 8h3M8 12h3M8 16h3" />
  </>,
);
export const HashIcon = icon(<path d="M5 9h15M4 15h15M10 3 8 21M16 3l-2 18" />);
export const ClockIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);
export const PenIcon = icon(<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />);
export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);
export const WalletIcon = icon(
  <>
    <path d="M3 7a2 2 0 0 1 2-2h13v4" />
    <path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h.01" />
  </>,
);
export const CreditCardIcon = icon(
  <>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M2.5 10h19M6.5 15h4" />
  </>,
);
export const LayersIcon = icon(<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" />);
export const DownloadIcon = icon(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />);
