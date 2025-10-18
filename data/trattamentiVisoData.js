const trattamentiViso = [
  {
    title: "Pulizia del viso con spatola ad ultrasuoni",
    description:
      "Pulizia viso con metodo indolore, completa di detersione, scrub specifico in base al tipo di pelle, leggero vapore di mare e pulizia con spatola ad ultrasuoni.",
    duration: 60,
    bookingOptions: [
      {
        type: "Pulizia del viso con spatola ad ultrasuoni",
        durations: [60],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Pulizia del viso ultrasuoni e mandelico",
    description:
      "Pulizia del viso profonda, metodo indolore con spatola ultrasuoni e acido mandelico. La pelle risulterà luminosa, pulita e levigata. ",
    duration: 60,
    bookingOptions: [
      {
        type: "Pulizia del viso ultrasuoni e mandelico",
        durations: [60],
        extraTime: 15,
      },
    ],
  },

  {
    title: "Elettroporatore viso",
    description:
      "Richiedilo in aggiunta al tuo trattamento, un macchinario che aumenta la permeabilità della pelle e consente di aumentare l’assorbimento in profondità degli attivi utilizzati in fase di trattamento. ",
    duration: "+10",
    includeInBooking: false,
  },
  {
    title: "Trattamento viso Eterna",
    description:
      "Il trattamento dell’eterna giovinezza, dona tono, luminosità e freschezza all’incarnato grazie alle manualità e ai principi attivi applicati. Completo di detersione, scrub, applicazione di acido mandelico e peeling enzimatico. Le sue tecniche di massaggio derivano dalle richieste diuna antica imperatrice giapponese, che chiese una cura che esaltasse e mantenesse la sua bellezza immutata nel tempo.",
    duration: 90,
    bookingOptions: [
      {
        type: "Trattamento viso Eterna",
        durations: [90],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Trattamento viso Fast Beauty",
    description:
      "Un trattamento ideale in pausa pranzo o per chi ha poco tempo, il soli 30 minuti la tua pelle sarà dissetata e ricaricata di vitamine essenziali.  ",
    duration: 30,
    bookingOptions: [
      {
        type: "Trattamento viso Fast Beauty",
        durations: [30],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Ossigeno dermo infusione",
    description:
      "Trattamento dall’ effetto rigenerante, riempitivo e liftante con acido ialuronico in combinazione con ossigeno puro. Il viso appare sin da subito più giovane, luminoso, la grana della pelle risulta più sottile ed omogenea.",
    duration: 60,
    bookingOptions: [
      {
        type: "Ossigeno dermo infusione",
        durations: [60],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Trattamenti viso specifici",
    description:
      "Trattamenti specifici per il viso, eseguiti con prodotti ricchi di principi attivi e sostanze rigeneranti. Dopo un’attenta valutazione della pelle ti consiglierò il trattamento viso più adatto a te.",
    duration: 60,
    bookingOptions: [
      {
        type: "Trattamenti viso specifici",
        durations: [60],
        extraTime: 15,
      },
    ],
    subcategories: [
      {
        title: "Trattamento agli acidi della frutta",
      },
      {
        title: "Schiarente per macchie e discromie",
      },
      {
        title: "Antiage e detox per pelli atone e spente",
      },
      {
        title: "Couperose e pelli sensibili",
      },
      {
        title: "Pelle grassa, acne e impura",
      },
      {
        title: "Idratante per pelli secche e asfittiche",
      },
    ],
  },
  {
    title: "Nemesis",
    description:
      "Trattamento viso con ingredienti iperfermentati e manovre di face yoga progettato per portare la routine di bellezza a un livello superiore. Grazie all’iperfermentazione possiede un elevato potere antiossidante ed è l’ alleato ideale per intervenire sugli inestetismi dell’invecchiamento cutaneo.",
    duration: 60,
    bookingOptions: [
      {
        type: "Nemesis",
        durations: [60],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Elite active",
    description:
      "Perfetta per chi cerca miglioramento della trama cutanea, uniformità dell’incarnato e rinnovamento cellulare. Con formule trattanti attive, efficaci e sicure, studiate per agire in modo mirato su imperfezioni, discromie e segni del tempo.",
    duration: 60,
    bookingOptions: [
      {
        type: "Elite active",
        durations: [60],
        extraTime: 15,
      },
    ],
  },
];

export default trattamentiViso;
