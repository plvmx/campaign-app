// Shared shape between app/api/registry/recent-registrations/route.ts and
// its page — kept out of route.ts itself, since Next.js's App Router
// restricts route.ts exports to recognized HTTP methods and route config
// (GET, maxDuration, etc.) and errors on anything else.
export interface RecentRegistration {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  postcode: string | null;
  registeredAt: string | null;
}
