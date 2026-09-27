import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Only the sign-in flow is public. Everything else requires a signed-in,
// invited user — this is what makes the site invite-only.
const isPublicRoute = createRouteMatcher(["/sign-in(.*)"]);

export default clerkMiddleware((auth, req) => {
  if (!isPublicRoute(req)) {
    auth().protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|.*\\.(?:html?|css|js|json|jpe?g|png|svg|ico|webp)).*)",
    "/(api|trpc)(.*)",
  ],
};
