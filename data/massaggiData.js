const massaggi = [
  {
    title: "Massaggio viso personalizzato",
    description:
      "Tramite una piccola consulenza potrai scegliere le texture, i profumi e il tipo di massaggio che preferisci (decontratturante, drenante, rilassante, anticellulite e rimodellante).",
    duration: 30,
    bookingOptions: [
      {
        type: "Massaggio viso personalizzato",
        durations: [30],
        extraTime: 5,
      },
    ],
  },
  {
    title: "Massaggio corpo personalizzato",
    description:
      "Tramite una piccola consulenza potrai scegliere le texture, i profumi e il tipo di massaggio che preferisci (decontratturante, drenante, rilassante, anticellulite e rimodellante).",
    duration: "30m / 50",
    bookingOptions: [
      {
        type: "Massaggio corpo personalizzato",
        durations: [30, 60],
        variants: ["Massaggio 30 minuti", "Massaggio 60 minuti"],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Massaggio corpo al cioccolato",
    description:
      "Questo massaggio, della durata di 45 minuti, idrata in profondità la pelle contrastando rughe e invecchiamento, grazie alle sostanze antiossidanti contenute al suo interno. È ottimo anche per stimolare la circolazione sanguigna. ",
    duration: 45,
    bookingOptions: [
      {
        type: "Massaggio corpo al cioccolato",
        durations: [45],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Pressoterapia",
    description:
      "Macchinario che simula un massaggio drenante manuale, favorisce le naturali funzioni del corpo, il ritorno venoso e l’eliminazione di sostanze di scarto dall’organismo. È consigliata per chi soffre di ritenzione idrica, cellulite e adiposità.",
    duration: "30m / 45",
    bookingOptions: [
      {
        type: "Pressoterapia",
        durations: [30, 45],
        variants: ["Pressoterapia 30 minuti", "Pressoterapia 45 minuti"],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Massaggio con Pindasweda",
    description:
      "Trattamento ayurvedico dalle origini antichissime. Questo massaggio si esegue utilizzando i Pinda, sacchettini realizzati in fibre naturali morbide, rilasciano i principi attivi delle erbe, combinando l'effetto benefico del calore dell’olio con le proprietà rilassanti dell’aromaterapia, sprigionando così un intenso profumo che avvolge il trattamento.",
    duration: "30m / 50",
    bookingOptions: [
      {
        type: "Massaggio con Pindasweda",
        durations: [30, 50],
        variants: [
          "Massaggio Pindasweda 30 minuti",
          "Massaggio Pindasweda 50 minuti",
        ],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Scrub al tè verde",
    description:
      "Un rituale esfoliante, nutriente e riossigenante che leviga la pelle e la rigenera in profondità. A base di tè bianco, verde e nero, sale integrale, fiordaliso e OxyForce®.",
    duration: "50m / 90",
    bookingOptions: [
      {
        type: "Scrub al tè verde",
        durations: [50, 90],
        variants: ["Scrub al tè verde 50 minuti", "Scrub al tè verde 90 minuti"],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Body brushing mineralizzante",
    description:
      "Un rituale esfoliante che riattiva la circolazione e mineralizza la pelle grazie all' acqua di mare purissima e alle spazzole natural",
    duration: "50m / 90",
    bookingOptions: [
      {
        type: "Body brushing mineralizzante",
        durations: [50, 90],
        variants: [
          "Body brushing 50 minuti",
          "Body brushing 90 minuti",
        ],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Savonage hammam",
    description:
      "Tradizionale rituale esfoliante con sapone nero marocchino all'eucalipto e guanto kessa. Nutre in profondità rendendo la pelle levigata e luminosa.",
    duration: "50m / 90",
    bookingOptions: [
      {
        type: "Savonage hammam",
        durations: [50, 90],
        variants: ["Savonage hammam 50 minuti", "Savonage hammam 90 minuti"],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Scrub drenante al sale integrale",
    description:
      "A base di sale pregiato e attivi marini di Bretagna, apporta minerali e idrata la pelle facendole ritrovare tutto il suo splendore.",
    duration: "50m / 90",
    bookingOptions: [
      {
        type: "Scrub drenante al sale integrale",
        durations: [50, 90],
        variants: [
          "Scrub drenante 50 minuti",
          "Scrub drenante 90 minuti",
        ],
        extraTime: 15,
      },
    ],
  },
];

export default massaggi;
