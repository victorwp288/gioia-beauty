const pedicure = [
  {
    title: "Pedicure classica",
    description: "Trattamento delle unghie e della pelle dei piedi.",
    duration: 60,
    bookingOptions: [
      {
        type: "Pedicure",
        durations: [60],
        extraTime: 5,
      },
    ],
  },
  {
    title: "Pedicure SPA",
    description:
      "Trattamento rilassante e rigenerante per la pelle dei tuoi piedi, con lo scopo di idratare in profondità la pelle e rendere i piedi più morbidi e leggeri.",
    duration: 60,
    bookingOptions: [
      {
        type: "Pedicure SPA",
        durations: [60],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Pedicure completa con cheratolitico",
    description:
      "Pedicure completo di calli e duroni. Trattamento effettuato con prodotti cheratolitici, che vanno a togliere tutti gli ispessimenti cutanei trattando calli e duroni senza l’utilizzo di strumenti aggressivi per la tua pelle.",
    duration: 60,
    bookingOptions: [
      {
        type: "Pedicure completa con cheratolitico",
        durations: [60],
        extraTime: 30,
      },
    ],
  },
  {
    title: "Maschera piedi",
    description:
      "Al momento della prenotazione, richiedila in aggiunta alla tua tua pedicure per ottenere i piedi morbidi e vellutati.",
    duration: 10,
    includeInBooking: false,
  },
  {
    title: "Pedicure berbero",
    description:
      "Un rituale che rigenera corpo e mente, ispirato ai segreti di bellezza nordafricani. Grazie al sapone nero e all’esfoliazione con il guanto Kessa, la pelle diventa incredibilmente liscia e vellutata. La maschera nutriente all’argilla marocchina dona idratazione profonda, mentre il massaggio con olio caldo di argan allevia la stanchezza e regala una sensazione di leggerezza assoluta.",
    duration: 75,
    bookingOptions: [
      {
        type: "Pedicure berbero",
        durations: [75],
        extraTime: 10,
      },
    ],
  },
  {
    title: "Pedicure Polinesiano",
    description:
      "Voliamo verso le spiagge bianche e assolate della Polinesia e affidiamo alla tradizione delle donne indigene la cura dei nostri piedi affaticati e disidratati. Utilizziamo ingredienti preziosi come la polpa di cocco e l’alga corallina per restituire idratazione e nutrimento alla pelle.",
    duration: 75,
    bookingOptions: [
      {
        type: "Pedicure polinesiano",
        durations: [75],
        extraTime: 10,
      },
    ],
  },
  {
    title: "Pedicure Siberiano",
    description:
      "Partiamo verso i freddi mari del nord e le loro acque incontaminate, il colore azzurro del cielo e il bianco candido degli iceberg e immergiamoci negli scenari incantati e rarefatti della Siberia, dove troveremo attivi d’eccezione per dare sollievo a piedi stanchi e gonfi.",
    duration: 75,
    bookingOptions: [
      {
        type: "Pedicure siberiano",
        durations: [75],
        extraTime: 10,
      },
    ],
  },
];

export default pedicure;
