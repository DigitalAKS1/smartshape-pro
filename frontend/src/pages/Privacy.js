import React from 'react';

const UPDATED = '12 June 2026';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <a href="/login" className="text-sm text-[#e94560] hover:underline">&larr; Back</a>
        <h1 className="text-3xl font-bold mt-4 mb-1">Privacy Policy</h1>
        <p className="text-sm text-[var(--text-muted)] mb-8">Last updated: {UPDATED}</p>

        <div className="space-y-6 text-sm leading-relaxed text-[var(--text-secondary)]">
          <section>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Who we are</h2>
            <p>SmartShape Pro ("we", "us") is operated by SmartShape (contact: info@smartshape.in).
              This policy explains what personal data we collect when schools and their staff use our
              portal and services, why we collect it, and your rights over it.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">What we collect</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Contact details you provide — name, email, phone, designation, school name and address.</li>
              <li>Business records you create or upload — quotations, orders, invoices, purchase orders, payments.</li>
              <li>Account and usage data — login times and, for field staff who opt in, location captured at check-in.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Why we use it</h2>
            <p>To provide the service you signed up for — managing quotations, orders, invoices and
              communication between your school and SmartShape. We do not sell your personal data.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Your rights</h2>
            <p>Under India's Digital Personal Data Protection Act, 2023, you may request access to,
              correction of, or deletion of your personal data. To make a request, email
              <a href="mailto:info@smartshape.in" className="text-[#e94560] hover:underline"> info@smartshape.in</a>
              and we will respond within a reasonable time.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Data security &amp; retention</h2>
            <p>We apply reasonable safeguards to protect your data and retain it only as long as needed
              to provide the service and meet legal/accounting obligations. Records required by law
              (e.g. tax invoices) are kept for the period the law requires.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Contact</h2>
            <p>Questions about this policy or your data: <a href="mailto:info@smartshape.in" className="text-[#e94560] hover:underline">info@smartshape.in</a>.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
