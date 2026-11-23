/**
 * Child safety standards — required by App Store / Play Console review.
 * Kept as a route so the deployed web build serves it at /child-safety and
 * store listings can point reviewers and users at a stable URL.
 *
 * Mirrors the privacy policy pattern (see PrivacyScreen). Update it alongside
 * the moderation code when enforcement practices change.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  );
}

export function ChildSafetyScreen() {
  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-2xl bg-background px-5 pb-16 pt-10 sm:px-8">
      <span className="text-3xl font-extrabold tracking-tight text-title">WIZZ</span>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
        Child Safety Standards
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: October 29, 2026</p>

      <p className="mt-6 text-sm leading-6 text-muted-foreground">
        WIZZ is committed to protecting children and keeping our community safe. We have zero
        tolerance for child sexual abuse and exploitation (CSAE), including child sexual abuse
        material (CSAM). This page explains our standards and how we enforce them.
      </p>

      <Section title="1. Prohibited content and behavior">
        <p>
          The following is strictly prohibited on WIZZ, in posts, shorts, comments, profiles,
          messages, and any other part of the app:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Child sexual abuse material (CSAM) or any sexualized depiction of a minor.</li>
          <li>Grooming, sexual solicitation, or sexual contact directed at a minor.</li>
          <li>Sextortion or threats involving intimate images of a minor.</li>
          <li>
            Trading, promoting, or linking to CSAM or to any content that sexualizes children.
          </li>
          <li>Any other content or conduct that sexually exploits or endangers children.</li>
        </ul>
      </Section>

      <Section title="2. Reporting">
        <p>
          Users can report posts, shorts, comments, profiles, and messages directly inside the app
          using the report option. Reports involving child safety are treated as the highest
          priority. You can also contact us directly at the email address below.
        </p>
      </Section>

      <Section title="3. How we enforce these standards">
        <ul className="list-disc space-y-2 pl-5">
          <li>We review reports and remove content that violates these standards.</li>
          <li>
            We permanently ban accounts that post or share CSAE content, or that engage in grooming
            or exploitation.
          </li>
          <li>
            We preserve relevant information where required by law so that authorities can
            investigate.
          </li>
        </ul>
      </Section>

      <Section title="4. Reporting to authorities">
        <p>
          When we become aware of apparent CSAM or child exploitation, we report it to the
          appropriate authorities, including the National Center for Missing &amp; Exploited
          Children (NCMEC) and national and regional law enforcement, in line with applicable laws.
        </p>
      </Section>

      <Section title="5. Legal compliance">
        <p>
          WIZZ complies with applicable child safety laws and cooperates with law enforcement
          requests relating to child safety.
        </p>
      </Section>

      <Section title="6. Contact">
        <p>
          Our designated contact for child safety and CSAM prevention questions:{" "}
          <a
            href="mailto:aamri5285@gmail.com"
            className="font-medium text-foreground underline underline-offset-2"
          >
            aamri5285@gmail.com
          </a>
        </p>
      </Section>
    </main>
  );
}
