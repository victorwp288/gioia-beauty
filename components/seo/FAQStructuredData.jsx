import React from "react";

const FAQStructuredData = () => {
  const faqData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Dove si trova il centro estetico Gioia Beauty?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Gioia Beauty si trova a Roveleto di Cadeo, in Via Emilia 60, 29010 (PC). Siamo facilmente raggiungibili dall'Emilia Romagna e dalle province limitrofe.",
        },
      },
      {
        "@type": "Question",
        name: "Quali trattamenti offre Gioia Beauty?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Offriamo una vasta gamma di trattamenti estetici: trattamenti viso (pulizia, anti-età, ossigeno dermo infusione), trattamenti corpo, manicure e pedicure, massaggi, laminazione ciglia e sopracciglia, ceretta, bagno turco e rituali dal mondo. Tutti i nostri servizi utilizzano prodotti vegani e biologici.",
        },
      },
      {
        "@type": "Question",
        name: "Gioia Beauty utilizza prodotti eco-sostenibili?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Sì, ci impegniamo per la sostenibilità utilizzando esclusivamente prodotti biologici, vegani e strumenti riutilizzabili e riciclabili. La nostra filosofia è basata sul rispetto per l'ambiente e gli animali.",
        },
      },
      {
        "@type": "Question",
        name: "Come posso prenotare un appuntamento?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Puoi prenotare chiamando il +39 391 421 3634, inviando un'email a gioiabeautyy@gmail.com, o utilizzando il sistema di prenotazione online sul nostro sito web.",
        },
      },
      {
        "@type": "Question",
        name: "Quali sono gli orari di apertura?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Siamo aperti: Lunedì e Mercoledì 9:00-19:00, Martedì e Giovedì 10:00-20:00, Venerdì 9:00-18:30. Chiusi Sabato e Domenica.",
        },
      },
      {
        "@type": "Question",
        name: "Offrite servizi per la sposa?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Sì, offriamo servizi specializzati per le spose inclusi trucco e acconciatura personalizzati, con prove preliminari per garantire il look perfetto per il tuo grande giorno.",
        },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(faqData),
      }}
    />
  );
};

export default FAQStructuredData;
