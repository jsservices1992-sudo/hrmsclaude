/**
 * Small stroke icons, inline so the console pulls no icon library.
 * All render on a 20px grid and inherit currentColor.
 */

type P = { className?: string };

const base = "h-[18px] w-[18px] shrink-0";

function Svg({ children, className }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${base} ${className ?? ""}`}
    >
      {children}
    </svg>
  );
}

export const IconHome = (p: P) => (
  <Svg {...p}>
    <path d="M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-3v-5H7v5H4a1 1 0 0 1-1-1V8.5Z" />
  </Svg>
);

export const IconUsers = (p: P) => (
  <Svg {...p}>
    <circle cx="7.5" cy="7" r="2.5" />
    <path d="M2.5 16c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" />
    <path d="M13 5.2a2.5 2.5 0 0 1 0 4.6M14.5 15.8c0-1.6-.5-3-1.4-4" />
  </Svg>
);

export const IconSitemap = (p: P) => (
  <Svg {...p}>
    <rect x="7.5" y="2.5" width="5" height="4" rx="1" />
    <rect x="2" y="13.5" width="5" height="4" rx="1" />
    <rect x="13" y="13.5" width="5" height="4" rx="1" />
    <path d="M10 6.5v3M4.5 13.5v-2h11v2" />
  </Svg>
);

export const IconUserPlus = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="7" r="2.75" />
    <path d="M2.5 16.5c0-2.6 2.5-4.5 5.5-4.5" />
    <path d="M14 11.5v5M11.5 14h5" />
  </Svg>
);

export const IconUserMinus = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="7" r="2.75" />
    <path d="M2.5 16.5c0-2.6 2.5-4.5 5.5-4.5" />
    <path d="M11.5 14h5" />
  </Svg>
);

export const IconCalendar = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="14" height="13" rx="1.5" />
    <path d="M3 8h14M7 2.5v3M13 2.5v3" />
  </Svg>
);

export const IconTable = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="4" width="15" height="12" rx="1.5" />
    <path d="M2.5 8h15M8 8v8" />
  </Svg>
);

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M3 10.5 7.5 15 17 5.5" />
  </Svg>
);

export const IconShield = (p: P) => (
  <Svg {...p}>
    <path d="M10 2.5 4 5v4.5c0 3.6 2.5 6.8 6 8 3.5-1.2 6-4.4 6-8V5l-6-2.5Z" />
    <path d="m7.5 10 1.8 1.8 3.4-3.6" />
  </Svg>
);

export const IconBuilding = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 17V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v13" />
    <path d="M11.5 8h4a1 1 0 0 1 1 1v8M2 17h16" />
    <path d="M6 6.5h3M6 9.5h3M6 12.5h3" />
  </Svg>
);

export const IconSliders = (p: P) => (
  <Svg {...p}>
    <path d="M3 6h9M15 6h2M3 14h2M8 14h9" />
    <circle cx="13.5" cy="6" r="1.75" />
    <circle cx="6.5" cy="14" r="1.75" />
  </Svg>
);

export const IconHistory = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6" />
    <path d="M3 3v3.5h3.5M10 6.5V10l2.5 1.5" />
  </Svg>
);

export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="M7.5 4.5 13 10l-5.5 5.5" />
  </Svg>
);

export const IconMenu = (p: P) => (
  <Svg {...p}>
    <path d="M3 5.5h14M3 10h14M3 14.5h14" />
  </Svg>
);

export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M5 5l10 10M15 5 5 15" />
  </Svg>
);

export const IconPanel = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="4" width="15" height="12" rx="1.5" />
    <path d="M7.5 4v12" />
  </Svg>
);

export const IconPercent = (p: P) => (
  <Svg {...p}>
    <path d="m5 15 10-10" />
    <circle cx="6.5" cy="6.5" r="2.25" />
    <circle cx="13.5" cy="13.5" r="2.25" />
  </Svg>
);

export const IconBanknote = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="5" width="16" height="10" rx="1.5" />
    <circle cx="10" cy="10" r="2.25" />
    <path d="M5 10h.01M15 10h.01" />
  </Svg>
);

export const IconStamp = (p: P) => (
  <Svg {...p}>
    <path d="M4 16.5h12M6 13.5h8v2H6z" />
    <path d="M8 13.5V9a2 2 0 0 1 2-2 2 2 0 0 0 0-4 2 2 0 0 0-2 2" />
  </Svg>
);

export const IconLedger = (p: P) => (
  <Svg {...p}>
    <path d="M4 3.5h11a1 1 0 0 1 1 1v13H5a1 1 0 0 1-1-1V3.5Z" />
    <path d="M4 3.5a1.5 1.5 0 0 0 0 3M8 8h5M8 11h5" />
  </Svg>
);

export const IconFlow = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="3" width="5" height="4" rx="1" />
    <rect x="12.5" y="3" width="5" height="4" rx="1" />
    <rect x="7.5" y="13" width="5" height="4" rx="1" />
    <path d="M5 7v2.5h10V7M10 9.5V13" />
  </Svg>
);

export const IconBox = (p: P) => (
  <Svg {...p}>
    <path d="M3 6.5 10 3l7 3.5-7 3.5-7-3.5Z" />
    <path d="M3 6.5V14l7 3.5 7-3.5V6.5" />
    <path d="M10 10v7.5" />
  </Svg>
);

export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="m17 17-4-4" />
  </Svg>
);

export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M10 3.5v13M3.5 10h13" />
  </Svg>
);

export const IconFilter = (p: P) => (
  <Svg {...p}>
    <path d="M3 4.5h14M6 10h8M8.5 15.5h3" />
  </Svg>
);

export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4 6h12M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6M6 6l.6 10a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L14 6" />
  </Svg>
);

export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M10 3v10M6 9.5 10 13.5 14 9.5" />
    <path d="M4 15.5h12v1.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-1.5Z" />
  </Svg>
);

export const ICONS = {
  home: IconHome,
  users: IconUsers,
  sitemap: IconSitemap,
  userPlus: IconUserPlus,
  userMinus: IconUserMinus,
  calendar: IconCalendar,
  table: IconTable,
  check: IconCheck,
  shield: IconShield,
  building: IconBuilding,
  sliders: IconSliders,
  history: IconHistory,
  percent: IconPercent,
  banknote: IconBanknote,
  stamp: IconStamp,
  ledger: IconLedger,
  flow: IconFlow,
  box: IconBox,
} as const;

export type IconName = keyof typeof ICONS;
