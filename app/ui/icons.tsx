// Nav icons (inline so there's nothing extra to load).

export type IconName =
  | "Home"
  | "Projects"
  | "Graffiti"
  | "Work orders"
  | "Lawn care"
  | "Other jobs"
  | "Food"
  | "About"
  | "Contact"
  | "Admin"
  | "Dashboard"
  | "More";

export function Icon({ name }: { name: IconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "Home":
      return (
        <svg {...common}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9.5h13V10" />
          <path d="M10 19.5v-5h4v5" />
        </svg>
      );
    case "Projects":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "Graffiti":
      return (
        <svg {...common}>
          <rect x="6" y="10" width="8" height="11" rx="1.8" />
          <path d="M8 10V7.5h4V10" />
          <path d="M9 7.5V5.5h2v2" />
          <path d="M17 6.5h.01M19.5 4.5h.01M19.5 8.5h.01M17 10.5h.01M19.5 12.5h.01" strokeWidth={2.4} />
        </svg>
      );
    case "Work orders":
      return (
        <svg {...common}>
          <rect x="5" y="4.5" width="14" height="16" rx="2" />
          <path d="M9 4.5V3h6v1.5" />
          <path d="M8.5 10h7M8.5 13.5h7M8.5 17h4" />
        </svg>
      );
    case "Lawn care":
      return (
        <svg {...common}>
          <path d="M3 20.5h18" />
          <path d="M6 20.5c0-4 .5-7 2-10 .5 3 1.5 5 1.5 10" />
          <path d="M11 20.5c0-5 .8-9 3-13 .6 4.5 1.8 8 1.8 13" />
          <path d="M16.5 20.5c0-3 .5-5.5 2-8 .4 2.5.5 5 .5 8" />
        </svg>
      );
    case "Other jobs":
      return (
        <svg {...common}>
          <path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2-.5-.5-2z" />
        </svg>
      );
    case "Food":
      return (
        <svg {...common}>
          <path d="M7 3v8a2 2 0 0 0 2 2v8" />
          <path d="M5 3v5.5M9 3v5.5" />
          <path d="M16.5 21V3c-2.2 1.3-3.5 4-3.5 7.5 0 1.9 1 3 3.5 3" />
        </svg>
      );
    case "About":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 20.5c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5" />
        </svg>
      );
    case "Contact":
      return (
        <svg {...common}>
          <rect x="3" y="5.5" width="18" height="13" rx="2" />
          <path d="m3.5 7 8.5 6 8.5-6" />
        </svg>
      );
    case "Admin":
      return (
        <svg {...common}>
          <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6L12 3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "Dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
    case "More":
      return (
        <svg {...common}>
          <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}
