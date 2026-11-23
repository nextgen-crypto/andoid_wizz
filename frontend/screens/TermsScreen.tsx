function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  );
}

export function TermsScreen() {
  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-2xl bg-background px-5 pb-16 pt-10 sm:px-8">
      <span className="text-3xl font-extrabold tracking-tight text-title">WIZZ</span>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">Terms of Service</h1>
      <p className="mt-1 text-sm text-muted-foreground">Effective November 6, 2026</p>

      <p className="mt-6 text-sm leading-6 text-muted-foreground">
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of WIZZ,
        including the mobile app, web app, and any related services (collectively, the
        &ldquo;Service&rdquo;). By creating an account or using the Service you agree to these
        Terms. If you do not agree, do not use the Service.
      </p>

      <Section title="1. Eligibility">
        <p>
          You must be at least 13 years old to use WIZZ. If you are under 18 you represent that your
          parent or legal guardian has reviewed and agreed to these Terms on your behalf. By using
          the Service you confirm that you meet these age requirements and that you are not barred
          from receiving services under applicable law.
        </p>
      </Section>

      <Section title="2. Your account">
        <p>
          You are responsible for maintaining the confidentiality of your login credentials and for
          all activity that occurs under your account. Notify us immediately if you suspect
          unauthorised access. We may suspend or terminate accounts that violate these Terms or that
          we believe have been compromised.
        </p>
        <p>
          You may not create an account on behalf of someone else, impersonate any person, or
          register under a false identity.
        </p>
      </Section>

      <Section title="3. User content">
        <p>
          WIZZ lets you post text, images, videos, shorts, stories, and messages
          (&ldquo;Content&rdquo;). You retain ownership of Content you create. By posting you grant
          WIZZ a worldwide, royalty-free, non-exclusive licence to host, store, display, reproduce,
          and distribute your Content solely to operate and improve the Service.
        </p>
        <p>You are solely responsible for the Content you post. You must not post Content that:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>infringes any copyright, trademark, or other intellectual-property right;</li>
          <li>is defamatory, harassing, threatening, or abusive;</li>
          <li>contains nudity, sexual content involving minors, or graphic violence;</li>
          <li>promotes illegal activity or constitutes spam;</li>
          <li>contains malicious code or attempts to interfere with the Service.</li>
        </ul>
        <p>
          We may remove Content that violates these Terms and may report it to law-enforcement where
          required.
        </p>
      </Section>

      <Section title="4. Prohibited conduct">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>use the Service for any unlawful purpose;</li>
          <li>
            attempt to gain unauthorised access to any part of the Service or its infrastructure;
          </li>
          <li>
            scrape, crawl, or use automated tools to extract data without our written permission;
          </li>
          <li>sell, transfer, or sublicence your account;</li>
          <li>
            manipulate engagement metrics (likes, followers, views) through inauthentic means;
          </li>
          <li>
            use the Blend (watch-together) feature to stream or share content you do not have the
            rights to redistribute.
          </li>
        </ul>
      </Section>

      <Section title="5. Subscriptions and payments">
        <p>
          WIZZ may offer optional paid subscriptions or in-app purchases. All payments are processed
          by Stripe. Subscription fees are charged at the start of each billing period and are
          non-refundable except where required by law. You can cancel at any time and your access
          continues until the end of the current paid period.
        </p>
        <p>
          Prices may change with reasonable advance notice. Continued use of a paid feature after a
          price change takes effect constitutes acceptance of the new price.
        </p>
      </Section>

      <Section title="6. Intellectual property">
        <p>
          All elements of the Service not created by users — including the WIZZ name, logo, design,
          software, and original content — are owned by or licensed to us. These Terms do not grant
          you any right to use our trademarks or branding without our prior written consent.
        </p>
      </Section>

      <Section title="7. Third-party services">
        <p>
          The Service integrates with third-party providers including Google (authentication),
          Supabase (data storage), Vercel (hosting), Stripe (payments), and Firebase (push
          notifications). Your use of those features is also subject to those providers&rsquo; own
          terms and policies. We are not responsible for the practices of third-party services.
        </p>
      </Section>

      <Section title="8. Termination">
        <p>
          You may delete your account at any time through the in-app settings or the{" "}
          <a
            href="/delete-account"
            className="font-medium text-foreground underline underline-offset-2"
          >
            account deletion page
          </a>
          . We may suspend or terminate your access at any time, with or without notice, for conduct
          that we believe violates these Terms or is otherwise harmful to the Service, other users,
          or us. On termination, your licence to use the Service ends immediately.
        </p>
      </Section>

      <Section title="9. Disclaimers">
        <p>
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT
          WARRANTY OF ANY KIND. TO THE FULLEST EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES,
          EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
          PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED,
          ERROR-FREE, OR FREE OF HARMFUL COMPONENTS.
        </p>
      </Section>

      <Section title="10. Limitation of liability">
        <p>
          TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, WIZZ AND ITS OPERATORS SHALL NOT BE
          LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING
          OUT OF OR RELATED TO YOUR USE OF, OR INABILITY TO USE, THE SERVICE — EVEN IF WE HAVE BEEN
          ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY TO YOU FOR ANY CLAIM SHALL
          NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE 12 MONTHS PRECEDING THE CLAIM
          OR (B) £50 GBP.
        </p>
      </Section>

      <Section title="11. Governing law">
        <p>
          These Terms are governed by and construed in accordance with the laws of England and
          Wales. Any disputes shall be subject to the exclusive jurisdiction of the courts of
          England and Wales, except where mandatory consumer-protection laws in your country of
          residence give you the right to bring proceedings locally.
        </p>
      </Section>

      <Section title="12. Changes to these Terms">
        <p>
          We may update these Terms from time to time. When we do, we will update the effective date
          at the top of this page. Material changes will be notified in-app. Continued use of the
          Service after changes take effect constitutes your acceptance of the revised Terms.
        </p>
      </Section>

      <Section title="13. Contact">
        <p>
          Questions about these Terms can be sent to the support email shown on our Google Play
          listing, or through the messages screen inside the app.
        </p>
      </Section>
    </main>
  );
}
