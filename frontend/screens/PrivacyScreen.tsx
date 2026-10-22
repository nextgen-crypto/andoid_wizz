/**
 * Static privacy policy — required field in Play Console before production.
 * Kept as a route so the deployed web build serves it at /privacy and the
 * Play listing can point reviewers and users at a stable URL.
 *
 * Every claim below maps to something the app actually does: email sign-in
 * (password, one-time link, or Google), Supabase as the data store, Vercel as
 * the host, camera/mic/photo access only when posting.
 * Update it alongside the code when data practices change.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  );
}

export function PrivacyScreen() {
  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-2xl bg-background px-5 pb-16 pt-10 sm:px-8">
      <span className="text-3xl font-extrabold tracking-tight text-title">WIZZ</span>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">Privacy Policy</h1>
      <p className="mt-1 text-sm text-muted-foreground">Effective October 22, 2026</p>

      <p className="mt-6 text-sm leading-6 text-muted-foreground">
        This policy explains what WIZZ collects, why, and the choices you have. The short version:
        we collect what the app needs to work — your account, the content you publish, and the
        interactions that build your feed — we don&rsquo;t sell it, and you can ask us to delete it.
      </p>

      <Section title="Information we collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="font-medium text-foreground">Account data:</span> your email address
            (used to create your account, sign you in, and recover access), plus the name, username,
            and profile details you choose to add.
          </li>
          <li>
            <span className="font-medium text-foreground">Content you create:</span> posts, photos,
            shorts, stories, comments, bookmarks, and direct messages.
          </li>
          <li>
            <span className="font-medium text-foreground">Interactions:</span> likes, follows, and
            the topics you explore — these shape your For You and Following feeds.
          </li>
          <li>
            <span className="font-medium text-foreground">Device permissions:</span> camera,
            microphone, and your photo library are requested only when you use them to create a post
            or short. You can deny them at any time in system settings.
          </li>
          <li>
            <span className="font-medium text-foreground">Technical data:</span> standard log
            information such as IP address, device type, and app version, used to keep the service
            reliable.
          </li>
        </ul>
      </Section>

      <Section title="How we use information">
        <p>
          To run your account, publish what you share, sync your feed across every device you sign
          into, moderate the platform, and protect users from abuse. Google Sign-In shares your
          name, email address, and profile picture with WIZZ so you don&rsquo;t have to retype them
          — governed by Google&rsquo;s own privacy policy.
        </p>
      </Section>

      <Section title="Where data lives">
        <p>
          WIZZ is hosted on Vercel and stores account and content data on Supabase. These providers
          process data only to run the service on our behalf. We do not sell your personal
          information, and we disclose it only where the law requires it.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p>
          We keep your information while your account is active so your feed works. Ask us to delete
          your account and its data at any time using the support email listed on our Google Play
          listing, or through the in-app messages screen — deletion completes within 30 days: your
          profile, posts, and messages are removed, leaving only security logs (up to 90 days) and
          any transaction records the law requires. The full steps are on the{" "}
          <a
            href="/delete-account"
            className="font-medium text-foreground underline underline-offset-2"
          >
            account deletion page
          </a>
          .
        </p>
      </Section>

      <Section title="Security">
        <p>
          Data travels over encrypted connections, and access to production systems is limited. No
          method of transmission is perfectly secure, but we treat protection of your account as a
          requirement, not a feature.
        </p>
      </Section>

      <Section title="Children">
        <p>
          WIZZ is not directed at children under 13, and we do not knowingly collect their
          information. If you believe a child has provided us data, contact us and we will remove
          it.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          When practices change, this page changes with them — the effective date above always
          reflects the current version.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions, requests, or deletion appeals go to the support email shown on our Google Play
          listing, or through the messages screen inside the app.
        </p>
      </Section>
    </main>
  );
}
