import { SignIn } from "@clerk/nextjs";
import AliveBackground from "../../AliveBackground";
import { signInAppearance } from "../../ui/clerkAppearance";

// Seen once per visit, so it gets the site's one real entrance (see the
// .signin-* rules in globals.css): the domain fades in place, the title
// leads, and the line, card and crew button follow with less travel.
export default function SignInPage() {
  return (
    <>
      <AliveBackground />
      <main className="signin">
        <div className="signin-head">
          <p className="signin-domain">isaacborland.com</p>
          <h1 className="hero-title">Personal project hub</h1>
          <p className="lede">Invite-only. If you don't have an invite, this isn't the place for you yet.</p>
        </div>

        <div className="signin-card">
          <SignIn appearance={signInAppearance} />
        </div>

        <a href="/crew" className="btn btn-secondary btn-lg signin-crew" style={{ color: "var(--accent)", borderColor: "var(--accent-line)" }}>
          Crew login
        </a>
      </main>
    </>
  );
}
