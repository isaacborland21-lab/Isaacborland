import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Only the sign-in flow is public. Everything else requires a signed-in,
// invited user — this is what makes the site invite-only.
const isPublicRoute = createRouteMatcher(["/sign-in(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|.*\\.(?:html?|css|js|json|jpe?g|png|svg|ico|webp)).*)",
    "/(api|trpc)(.*)",
  ],
};
