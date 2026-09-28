import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// The sign-in page (and its nested Clerk routes, e.g. factor-two auth) is
// the only route a human visits without a signed-in session — everything
// else redirects to it. The Clerk webhook is a separate case: it's called
// server-to-server by Clerk itself, with no browser session, and verifies
// its own authenticity via a svix signature inside the route handler.
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/api/webhooks/clerk"]);

export default clerkMiddleware((auth, req) => {
  if (!isPublicRoute(req)) {
    auth().protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
