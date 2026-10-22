/**
 * Account-deletion request page — the URL field Google Play requires in the
 * account-deletion declaration. Play's checklist asks this page to do three
 * things, so each section below maps to one: the steps, what's deleted vs
 * kept (with retention periods), and it names the app (WIZZ) exactly as the
 * store listing does.
 *
 * The app has no self-serve delete button, so requests arrive through the
 * in-app Messages screen or the support email on the listing — keep this
 * page and the PrivacyScreen's Retention and deletion section in sync.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  );
}

export function DeleteAccountScreen() {
  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-2xl bg-background px-5 pb-16 pt-10 sm:px-8">
      <span className="text-3xl font-extrabold tracking-tight text-title">WIZZ</span>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
        Delete your WIZZ account
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Request deletion of your account and everything tied to it.
      </p>

      <Section title="How to request deletion">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <span className="font-medium text-foreground">Sign in to WIZZ</span> and open the{" "}
            <span className="font-medium text-foreground">Messages</span> screen.
          </li>
          <li>
            Send a message saying{" "}
            <span className="font-medium text-foreground">“Delete my account”</span> to WIZZ support
            — or email the support address shown on our Google Play listing.
          </li>
          <li>
            We confirm by email and start right away. Deletion is{" "}
            <span className="font-medium text-foreground">completed within 30 days</span> of your
            request.
          </li>
        </ol>
      </Section>

      <Section title="What gets deleted">
        <ul className="list-disc space-y-2 pl-5">
          <li>Your profile: display name, username, avatar, and bio.</li>
          <li>Everything you published: posts, shorts, stories, and comments.</li>
          <li>Your activity graph: bookmarks, likes, and who you follow or follow you.</li>
          <li>Your direct messages.</li>
        </ul>
      </Section>

      <Section title="What is kept, and for how long">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="font-medium text-foreground">Security logs</span> (IP address, device,
            failed sign-in attempts) — kept up to{" "}
            <span className="font-medium text-foreground">90 days</span> for fraud prevention, then
            deleted.
          </li>
          <li>
            <span className="font-medium text-foreground">Transaction records</span> if you ever
            paid for a subscription — kept only as long as tax and accounting law requires, and
            never used to contact you.
          </li>
        </ul>
        <p>
          Nothing else is retained — after deletion the account and its data cannot be restored.
        </p>
      </Section>

      <Section title="Data deletion without closing your account">
        <p>
          Prefer to keep your account? The same channels — the in-app Messages screen or the support
          email on our Play listing — can answer questions about your data before you decide.
        </p>
      </Section>
    </main>
  );
}
