import React from 'react';

const UPDATED = '12 June 2026';

export default function Terms() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <a href="/login" className="text-sm text-[#e94560] hover:underline">&larr; Back</a>
        <h1 className="text-3xl font-bold mt-4 mb-1">Terms of Service</h1>
        <p className="text-sm text-[var(--text-muted)] mb-8">Last updated: {UPDATED}</p>

        <div className="space-y-6 text-sm leading-relaxed text-[var(--text-secondary)]">
          <section>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">1. Acceptance</h2>
            <p>By using the SmartShape Pro portal you agree to these terms. If you are using it on behalf
              of a school or organisation, you confirm you are authorised to do so.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">2. Use of the service</h2>
            <p>The service is provided to manage quotations, orders, invoices and related communication
              between your school and SmartShape. You agree to use it lawfully, to keep your login
              credentials secure, and not to attempt to access data that is not yours.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">3. Your data</h2>
            <p>Your use of the service is also governed by our <a href="/privacy" className="text-[#e94560] hover:underline">Privacy Policy</a>.
              You retain ownership of the business records you enter; we process them to provide the service.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">4. Availability</h2>
            <p>We aim to keep the service available and reliable, but it is provided "as is". We may
              perform maintenance or updates, and occasional downtime can occur.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">5. Limitation of liability</h2>
            <p>To the extent permitted by law, SmartShape is not liable for indirect or consequential
              losses arising from use of the service. Nothing in these terms limits liability that
              cannot be limited under applicable law.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">6. Contact</h2>
            <p>Questions about these terms: <a href="mailto:info@smartshape.in" className="text-[#e94560] hover:underline">info@smartshape.in</a>.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
