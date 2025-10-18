const rituali = [
  {
    title: "Rituale Coccole di cotone",
    description:
      "Elasticizzante, lenitivo, idratante. Questo rituale è una coccola avvolgente ideale come trattamento in gravidanza o come impacco lenitivo e rigenerante dopo sole. Ottimo trattamento elasticizzante per chi è soggetto a smagliature. A base di aloe, acqua di mare e polvere di cotone; idrata in profondità, lenisce i rossori, elasticizza il tessuto. ",
    bookingOptions: [
      {
        type: "Rituale Coccole di cotone",
        durations: [50, 60, 90],
        variants: ["50 minuti", "60 minuti", "90 minuti"],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Rituale India",
    description:
      "Detossinante, rassodante, anti age. Una coccola rigenerante rassodante che idrata in profondità, leviga e rigenera il tessuto. Ottimo trattamento in tutti i casi in cui la pelle risulta spenta e svuotata, grazie alle sue proprietà antiage e rassodanti.",
    bookingOptions: [
      {
        type: "Rituale India",
        durations: [50, 60, 90],
        variants: ["50 minuti", "60 minuti", "90 minuti"],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Rituale Himalaya",
    description:
      "Mineralizzante, decontratturante. Tutta la potenza del sale Rosa per un trattamento decontratturante e altamente detossinante. A base di oli essenziali, sale fossile ricco di minerali, cuscini caldi, sfere e pietre di sale. ",
    subcategories: [
      {
        title: "Solo schiena - tensioni localizzate e stress",
        duration: 50,
      },
    ],
    bookingOptions: [
      {
        type: "Rituale Himalaya",
        durations: [50, 60, 90],
        variants: ["50 minuti", "60 minuti", "90 minuti"],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Rituale Marrakech",
    description:
      "Rigenerante, detossinante, levigante. Questa coccola di purificazione profonda detossina, leviga, nutre tessuti in profondità e li ricarica di sostanze essenziali, rendendo la pelle liscia e luminosa.",
    subcategories: [
      {
        title: "Solo schiena - tensioni localizzate e stress",
        duration: 50,
      },
    ],
    bookingOptions: [
      {
        type: "Rituale Marrakech",
        durations: [50, 60, 90],
        variants: ["50 minuti", "60 minuti", "90 minuti"],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Rituale Cute",
    description:
      "Rilassante, rigenerante, detossinante. Grazie al massaggio con oli essenziali e all’applicazione di acqua di mare liofilizzata, il rituale aiuta a ristabilire le normali funzioni del cuoio capelluto, garantendo un benessere totale per pelle e corpo.",
    bookingOptions: [
      {
        type: "Rituale Cute",
        durations: [50, 60, 90],
        variants: ["50 minuti", "60 minuti", "90 minuti"],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Rituale Kleopatra",
    description:
      "Ispirato ai segreti di bellezza della leggendaria regina d’Egitto, questo rituale è un’esperienza sensoriale profonda che nutre, avvolge, rigenera.",
    bookingOptions: [
      {
        type: "Rituale Kleopatra",
        durations: [50, 60, 90],
        variants: ["50 minuti", "60 minuti", "90 minuti"],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Rituale Kleopatra",
    description:
      "Ispirato ai segreti di bellezza della leggendaria regina d’Egitto, questo rituale è un’esperienza sensoriale profonda che nutre, avvolge, rigenera.",
    bookingOptions: [
      {
        type: "Rituale Kleopatra",
        durations: [50, 60, 90],
        variants: ["50 minuti", "60 minuti", "90 minuti"],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Rituale Amazzonia",
    description:
      "Trasporta nel cuore della foresta amazzonica, tra profumi di cacao, agrumi e noce del Brasile. Un trattamento corpo che rilassa le tensioni, stimola le endorfine e avvolge i sensi. L’esperienza è resa unica dall’utilizzo del bastone della pioggia.",
    bookingOptions: [
      {
        type: "Rituale Amazzonia",
        durations: [50, 60, 90],
        variants: ["50 minuti", "60 minuti", "90 minuti"],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Rituale Kyoto",
    description:
      "Un omaggio alla bellezza e all’eleganza femminile, con fragranze di fiori di ciliegio e mandorle. Viso e corpo ritrovano nutrimento, luminosità e compattezza, grazie a un’azione antiossidante e all’utilizzo di accessori ispirati alla tradizione giapponese.",
    bookingOptions: [
      {
        type: "Rituale Kyoto",
        durations: [50, 60, 90],
        variants: ["50 minuti", "60 minuti", "90 minuti"],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Scrub corpo Aromatico",
    description:
      "Rimuovi impurità e cellule morte tramite quest’esperienza sensoriale. Scegli i profumi che più preferisci e goditi il relax; il risultato sarà una pelle più liscia, omogenea e idratata.",
    duration: 30,
    bookingOptions: [
      {
        type: "Scrub corpo aromatico",
        durations: [30, 60],
        variants: ["30 minuti", "60 minuti"],
        extraTime: 15,
      },
    ],
    subcategories: [
      {
        title: "30 minuti",
        duration: 60,
      },
    ],
  },
  {
    title: "Rituale Bora Bora",
    description:
      "Un’esperienza tropicale con fragranze di cocco e vaniglia che alleviano lo stress. Grazie a polpa di cocco e alga corallina, dona nutrimento, ristruttura e remineralizza la pelle. Perfetto come preparazione al sole o per una pausa di relax.",
    bookingOptions: [
      {
        type: "Rituale Bora Bora",
        durations: [50, 60, 90],
        variants: ["50 minuti", "60 minuti", "90 minuti"],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Rituale Siberia",
    description:
      "Evoca l’atmosfera dei mari glaciali con colori azzurro ghiaccio e texture che ricordano gli iceberg. Un rituale viso e corpo ideale per pelli sensibili e stressate: rinforza la barriera cutanea, decongestiona e dona un effetto antiossidante e lenitivo.",
    bookingOptions: [
      {
        type: "Rituale Siberia",
        durations: [50, 60, 90],
        variants: ["50 minuti", "60 minuti", "90 minuti"],
        extraTime: 15,
      },
    ],
  },
];
export default rituali;
