// Clerk's sign-in card and account menu, themed to match the site.
// Shared by the sign-in page, the hub and (later) the crew page.

const sans = "'IBM Plex Sans', sans-serif";
const mono = "'IBM Plex Mono', monospace";

const variables = {
  colorPrimary: "#e8703a",
  colorBackground: "var(--surface)",
  colorText: "var(--text)",
  colorTextSecondary: "var(--text-dim)",
  colorInputBackground: "var(--bg)",
  colorInputText: "var(--text)",
  borderRadius: "10px",
  fontFamily: sans,
};

export const signInAppearance = {
  variables,
  elements: {
    card: {
      border: "1px solid rgba(255, 255, 255, 0.1)",
      boxShadow: "0 24px 60px -24px rgba(0, 0, 0, 0.7)",
    },
    headerTitle: { fontFamily: mono },
    footer: { display: "none" },
    formButtonPrimary: {
      color: "#1a0f08",
      fontWeight: 600,
      transition: "transform 140ms cubic-bezier(0.23, 1, 0.32, 1)",
      "&:active": { transform: "scale(0.97)" },
    },
  },
};

export const userButtonAppearance = {
  variables,
  elements: {
    avatarBox: { width: 30, height: 30 },
    userButtonPopoverCard: {
      border: "1px solid rgba(255, 255, 255, 0.1)",
      boxShadow: "0 24px 60px -24px rgba(0, 0, 0, 0.7)",
    },
  },
};
