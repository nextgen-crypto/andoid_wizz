import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Layout route for `/news`.
 *
 * `validateSearch` lives here (not on the index) so the `q` param is shared by
 * every child — the index feed and `/news/$articleId` alike. The component is a
 * bare `<Outlet />`: the actual screens render in the child routes. Without
 * this Outlet the child `$articleId` route would run its loader but never paint
 * its component, so clicking a headline would silently show the feed again.
 */
export const Route = createFileRoute("/news")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search["q"] === "string" ? (search["q"] as string) : "",
  }),
  component: () => <Outlet />,
});
