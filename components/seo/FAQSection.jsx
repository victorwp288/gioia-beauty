import {
  BUSINESS_INFO,
  formattedAddress,
  openingHoursSummary,
} from "@/lib/content/businessInfo";

const faqByLocale = {
  it: [
    [
      "Dove si trova Gioia Beauty?",
      `Il centro si trova in ${formattedAddress()}.`,
    ],
    [
      "Quali trattamenti offre il centro?",
      "Offriamo trattamenti viso e corpo, manicure e pedicure, massaggi, laminazione ciglia e sopracciglia, ceretta, bagno turco e rituali benessere.",
    ],
    [
      "Utilizzate prodotti eco-sostenibili?",
      "Scegliamo prodotti biologici e vegani e, quando possibile, strumenti riutilizzabili e riciclabili.",
    ],
    [
      "Come posso prenotare?",
      `Puoi usare il modulo di prenotazione online, chiamare il ${BUSINESS_INFO.phoneDisplay} o scrivere a ${BUSINESS_INFO.email}.`,
    ],
    [
      "Quali sono gli orari di apertura?",
      openingHoursSummary("it"),
    ],
  ],
  en: [
    [
      "Where is Gioia Beauty?",
      `The salon is at ${formattedAddress()}, near Piacenza.`,
    ],
    [
      "Which treatments do you offer?",
      "We offer face and body treatments, manicure and pedicure, massage, lash and brow treatments, waxing, a steam bath and wellness rituals.",
    ],
    [
      "Do you use eco-conscious products?",
      "We choose organic and vegan products and, where possible, reusable and recyclable tools.",
    ],
    [
      "How can I book?",
      `Use the online booking form, call ${BUSINESS_INFO.phoneDisplay} or email ${BUSINESS_INFO.email}.`,
    ],
    [
      "What are your opening hours?",
      openingHoursSummary("en"),
    ],
  ],
};

export default function FAQSection({ locale = "it" }) {
  const faq = faqByLocale[locale] || faqByLocale.it;
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(([name, text]) => ({
      "@type": "Question",
      name,
      acceptedAnswer: { "@type": "Answer", text },
    })),
  };

  return (
    <section
      className="mx-auto w-[90vw] py-16 md:w-[70vw]"
      aria-labelledby="faq-heading"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <p className="text-xs font-extrabold uppercase text-primary">
        {locale === "en" ? "Useful information" : "Informazioni utili"}
      </p>
      <h2 id="faq-heading" className="mt-2 font-serif text-3xl font-bold">
        {locale === "en" ? "Frequently asked questions" : "Domande frequenti"}
      </h2>
      <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
        {faq.map(([question, answer]) => (
          <details key={question} className="group py-5">
            <summary className="cursor-pointer list-none pr-8 font-semibold marker:hidden">
              {question}
            </summary>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              {answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
